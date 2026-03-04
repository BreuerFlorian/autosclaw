import express from "express";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { buildAgentImage, stopAgent, listContainers } from "./containers.js";
import {
  type AppContext,
  type AgentState,
  type BrowserClient,
  broadcastAgentList,
  setupWebSockets,
} from "./communication.js";
import { createApiRouter } from "./api.js";
import { seedAdminUser, loadAllAgents, loadMessages, closeDatabase, softDeleteAgent, updateAgentRunningState, hydrateMessages } from "./db.js";
import { startScheduler } from "./schedules.js";
import { authRouter, verifyToken } from "./auth.js";
import { createPushRouter } from "./pushRoutes.js";
import { notifyAgentCompleted } from "./push.js";

// ─── State ───────────────────────────────────────────────────────────────────

const agents = new Map<string, AgentState>();
const browsers = new Set<BrowserClient>();

// ─── Build agent image ───────────────────────────────────────────────────────

const agentDir = join(fileURLToPath(import.meta.url), "..", "..", "..", "agent");
await buildAgentImage(agentDir);

// Restore persisted agents and reconcile with Docker
{
  const persisted = loadAllAgents();
  const containers = await listContainers();
  const runningContainerIds = new Set(containers.map((c) => c.agentId));

  let restored = 0;
  let cleaned = 0;
  for (const p of persisted) {
    if (runningContainerIds.has(p.id)) {
      // Container still exists — keep agent, wait for possible reconnection
      agents.set(p.id, {
        id: p.id,
        name: p.name,
        token: p.token,
        purpose: p.purpose,
        systemPrompt: p.system_prompt,
        status: "stopped",
        processing: false,
        ws: null,
        textHistory: hydrateMessages(loadMessages(p.id)),
        costUSD: p.cost_usd,
        inputTokens: p.input_tokens,
        outputTokens: p.output_tokens,
        cacheReadInputTokens: p.cache_read_input_tokens,
        cacheCreationInputTokens: p.cache_creation_input_tokens,
        waitingForAskUser: false,
        pendingAskQuestions: null,
        createdBy: p.created_by,
        permissions: p.permissions ? p.permissions.split(",").filter(Boolean) : [],
        projectId: p.project_id ?? null,
      });
      restored++;
    } else {
      // No container — agent is dead, soft-delete from DB
      updateAgentRunningState(p.id, "stopped");
      softDeleteAgent(p.id);
      cleaned++;
    }
  }

  // Kill orphan containers (in Docker but not in DB)
  const persistedIds = new Set(persisted.map((p) => p.id));
  for (const c of containers) {
    if (!persistedIds.has(c.agentId)) {
      logger.warn("Killing orphan container", { containerName: c.containerName, agentId: c.agentId });
      stopAgent(c.agentId).catch((err) => logger.error("Failed to kill orphan container", { agentId: c.agentId, error: String(err) }));
    }
  }

  if (restored) logger.info("Restored persisted agents", { count: restored });
  if (cleaned) logger.info("Cleaned up stopped agents from DB", { count: cleaned });
}

// ─── Seed admin user ─────────────────────────────────────────────────────────

seedAdminUser();

// ─── App context (shared by api + communication) ────────────────────────────

const ctx: AppContext = {
  agents,
  browsers,
  envFile: env.ENV_FILE,
  managerHost: env.MANAGER_HOST,
  port: env.PORT,
  onAgentExit: () => {},
};

ctx.onAgentExit = (exitId: string, code: number | null) => {
  const a = agents.get(exitId);
  if (a) {
    a.status = "stopped";
    a.processing = false;
    a.ws = null;
    updateAgentRunningState(exitId, "stopped");
    softDeleteAgent(exitId);
    notifyAgentCompleted(a.name, exitId);
    agents.delete(exitId);
    broadcastAgentList(ctx);
    logger.info("Agent exited", { agentId: exitId, exitCode: code });
  }
};

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
const publicDir = join(fileURLToPath(import.meta.url), "..", "public");

// Request ID middleware
app.use((req, res, next) => {
  const requestId = randomUUID();
  (req as unknown as Record<string, unknown>).requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});

app.use(express.json());
app.use(authRouter);
app.use("/api/push", createPushRouter());
app.use("/api", createApiRouter(ctx));
app.use(express.static(publicDir));

// ─── WebSocket + upgrade handling ────────────────────────────────────────────

const server = app.listen(env.PORT, "0.0.0.0", () => {
  logger.info("Manager started", { dashboardUrl: `http://localhost:${env.PORT}`, wsEndpoint: `ws://localhost:${env.PORT}/agent`, port: env.PORT });
});

const { agentWss, browserWss } = setupWebSockets(server, ctx, verifyToken);
const schedulerInterval = startScheduler(ctx);

// ─── Periodic health check — reconcile in-memory state with Docker ────────

const HEALTH_CHECK_INTERVAL_MS = 30_000;

async function healthCheck(): Promise<void> {
  const containers = await listContainers();
  const runningIds = new Set(containers.map((c) => c.agentId));
  let changed = false;

  for (const [id, agent] of ctx.agents) {
    if (!runningIds.has(id)) {
      // Container gone — clean up
      logger.warn("Health check: agent has no container", { agentId: id, name: agent.name, previousStatus: agent.status });
      agent.status = "stopped";
      agent.processing = false;
      agent.ws = null;
      updateAgentRunningState(id, "stopped");
      softDeleteAgent(id);
      notifyAgentCompleted(agent.name, id);
      ctx.agents.delete(id);
      changed = true;
    }
  }

  // Kill orphan containers
  for (const c of containers) {
    if (!ctx.agents.has(c.agentId)) {
      logger.warn("Health check: killing orphan container", { containerName: c.containerName, agentId: c.agentId });
      stopAgent(c.agentId).catch((err) => logger.error("Failed to kill orphan container", { agentId: c.agentId, error: String(err) }));
    }
  }

  if (changed) broadcastAgentList(ctx);
}

const healthCheckInterval = setInterval(() => {
  healthCheck().catch((err) => logger.error("Health check error", { error: String(err) }));
}, HEALTH_CHECK_INTERVAL_MS);

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error("Port already in use", { port: env.PORT });
  } else {
    logger.error("Server error", { error: String(err) });
  }
  process.exit(1);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutdown initiated", { signal });

  clearInterval(schedulerInterval);
  clearInterval(healthCheckInterval);

  // Stop all running agents
  const stopPromises: Promise<void>[] = [];
  for (const [id, agent] of ctx.agents) {
    if (agent.status === "running" || agent.status === "starting") {
      logger.info("Stopping agent", { agentId: id, name: agent.name });
      stopPromises.push(stopAgent(id).catch((err) => logger.error("Failed to stop agent", { agentId: id, error: String(err) })));
    }
  }
  await Promise.all(stopPromises);

  // Close WebSocket servers
  agentWss.close();
  browserWss.close();

  // Close HTTP server
  server.close(() => {
    closeDatabase();
    logger.info("Shutdown complete");
    process.exit(0);
  });

  // Force exit if server.close hangs
  setTimeout(() => {
    logger.error("Shutdown timed out — forcing exit");
    process.exit(1);
  }, 15_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
