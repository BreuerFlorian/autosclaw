import { Router, type Request, type Response, type NextFunction } from "express";
import { WebSocket } from "ws";
import { CronExpressionParser } from "cron-parser";
import { startAgent, stopAgent } from "./containers.js";
import {
  type AppContext,
  makeAgentState,
  broadcastAgentList,
  broadcastScheduleList,
  validateAgentToken,
  extractBearerToken,
} from "./communication.js";
import {
  createSchedule,
  getSchedules,
  getScheduleById,
  getScheduleByName,
  updateSchedule,
  setScheduleStatus,
  saveAgent,
  softDeleteAgent,
  getAgents,
  checkDatabase,
  updateAgentRunningState,
  getProjectById,
} from "./db.js";
import { verifyToken, requireRole } from "./auth.js";
import { logger } from "./logger.js";

// ─── Agent caller info attached to req by dual auth ─────────────────────────

type AgentCaller = {
  agentId: string;
  permissions: string[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      agentCaller?: AgentCaller;
    }
  }
}

// ─── Dual auth middleware: JWT (users) or agent token ────────────────────────

function dualAuth(ctx: AppContext) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: "No token" });
      return;
    }

    // Try JWT first (for dashboard users)
    const payload = verifyToken(token);
    if (payload) {
      req.user = { id: payload.sub, username: payload.username, role: payload.role };
      next();
      return;
    }

    // Try agent token
    const agent = validateAgentToken(ctx.agents, token);
    if (agent) {
      req.agentCaller = { agentId: agent.id, permissions: agent.permissions };
      next();
      return;
    }

    res.status(401).json({ error: "Invalid token" });
  };
}

// ─── Permission middleware for agent callers ─────────────────────────────────

function requireAgentPermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // User callers pass through (user role checks handled separately)
    if (req.user) {
      next();
      return;
    }
    // Agent callers must have the required permission
    if (req.agentCaller?.permissions.includes(permission)) {
      next();
      return;
    }
    res.status(403).json({ error: `Agent lacks permission: ${permission}` });
  };
}

// ─── Combined user role + agent permission guard ─────────────────────────────
// For mutation routes: users need the right role, agents need the right permission

function requireUserRoleOrAgentPermission(roles: string[], permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user) {
      if (roles.includes(req.user.role)) {
        next();
        return;
      }
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    if (req.agentCaller?.permissions.includes(permission)) {
      next();
      return;
    }
    res.status(403).json({ error: `Agent lacks permission: ${permission}` });
  };
}

export function createApiRouter(ctx: AppContext): Router {
  const router = Router();

  // API request logging
  router.use((req: Request, res: Response, next) => {
    const start = Date.now();
    const requestId = (req as unknown as Record<string, unknown>).requestId as string | undefined;
    res.on("finish", () => {
      logger.info("API request", {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
        ...(requestId ? { requestId } : {}),
      });
    });
    next();
  });

  // GET /api/health — no auth required (for load balancers / monitoring)
  router.get("/health", (req: Request, res: Response) => {
    const dbStatus = checkDatabase();
    if (dbStatus !== "connected") {
      res.status(503).json({ status: "error" });
      return;
    }
    res.json({ status: "ok" });
  });

  // Dual auth middleware: accepts JWT (users) or agent hex tokens
  router.use(dualAuth(ctx));

  // GET /api/agents — users: all roles; agents: requires agent:spawn
  router.get("/agents", requireAgentPermission("agent:spawn"), (req: Request, res: Response) => {
    const selfId = (req.query.self as string) ?? "";
    const includeDeleted = req.query.include_deleted === "true";

    // If caller is an agent with a project, filter to that project only
    const callerProjectId = req.agentCaller
      ? ctx.agents.get(req.agentCaller.agentId)?.projectId ?? null
      : null;

    // Active agents from in-memory state
    let activeList = Array.from(ctx.agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
      purpose: a.purpose,
      status: a.status,
      isSelf: a.id === selfId,
      createdBy: a.createdBy,
      projectId: a.projectId,
    }));

    // Project-scoped: agents in a project can only see agents in their project
    if (callerProjectId) {
      activeList = activeList.filter((a) => a.projectId === callerProjectId);
    }

    if (!includeDeleted) {
      res.json({ agents: activeList });
      return;
    }

    // Include deleted agents from database
    let deletedAgents = getAgents(true)
      .filter((a) => a.status === "deleted")
      .map((a) => ({
        id: a.id,
        name: a.name,
        purpose: a.purpose,
        status: "deleted" as const,
        isSelf: a.id === selfId,
        costUSD: a.cost_usd,
        inputTokens: a.input_tokens,
        outputTokens: a.output_tokens,
        cacheReadInputTokens: a.cache_read_input_tokens,
        cacheCreationInputTokens: a.cache_creation_input_tokens,
        deletedAt: a.deleted_at,
        createdBy: a.created_by,
        projectId: a.project_id,
      }));

    if (callerProjectId) {
      deletedAgents = deletedAgents.filter((a) => a.projectId === callerProjectId);
    }

    res.json({ agents: [...activeList, ...deletedAgents] });
  });

  // POST /api/spawn — users: admin/member; agents: requires agent:spawn
  router.post("/spawn", requireUserRoleOrAgentPermission(["admin", "member"], "agent:spawn"), async (req: Request, res: Response) => {
    try {
      const name = (typeof req.body.name === "string" && req.body.name.trim()) || "Untitled Agent";
      const purpose = (typeof req.body.purpose === "string" && req.body.purpose.trim()) || "";
      const systemPrompt = (typeof req.body.systemPrompt === "string" && req.body.systemPrompt.trim()) || "";

      if (name.length > 255) { res.status(400).json({ error: "name must be 255 characters or less" }); return; }
      if (purpose.length > 1000) { res.status(400).json({ error: "purpose must be 1000 characters or less" }); return; }
      if (systemPrompt.length > 100000) { res.status(400).json({ error: "systemPrompt must be 100000 characters or less" }); return; }

      // Determine creator and permissions for spawned agent
      const createdBy = req.user?.id ?? null;
      const agentPermissions = req.agentCaller
        ? req.agentCaller.permissions.join(",")  // child inherits parent permissions
        : "";  // user-spawned via API: no default permissions

      // Inherit project from parent agent caller if applicable
      const callerProjectId = req.agentCaller
        ? ctx.agents.get(req.agentCaller.agentId)?.projectId ?? null
        : null;
      let extraEnv = "";
      if (callerProjectId) {
        const project = getProjectById(callerProjectId);
        if (project && project.github_token) {
          extraEnv = `\nGITHUB_TOKEN=${project.github_token}\nGH_TOKEN=${project.github_token}`;
        }
      }

      const managerUrl = `ws://${ctx.managerHost}:${ctx.port}/agent`;

      const container = await startAgent(name, ctx.envFile, managerUrl, ctx.onAgentExit, extraEnv);
      const permissionsArray = agentPermissions ? agentPermissions.split(",") : [];
      const state = makeAgentState(container.id, name, container.token, null, purpose, systemPrompt, createdBy, permissionsArray, callerProjectId);
      ctx.agents.set(container.id, state);
      saveAgent(container.id, name, container.token, purpose, systemPrompt, createdBy, agentPermissions, callerProjectId);
      updateAgentRunningState(container.id, "starting");
      broadcastAgentList(ctx);
      logger.info("Agent spawned", { agentId: container.id, name, source: "api", userId: createdBy });

      res.json({ agentId: container.id, name });
    } catch (err) {
      logger.error("Failed to spawn agent", { error: String(err) });
      res.status(500).json({ error: "Failed to spawn agent" });
    }
  });

  // POST /api/despawn — users: admin/member (ownership check); agents: requires agent:spawn
  router.post("/despawn", requireUserRoleOrAgentPermission(["admin", "member"], "agent:spawn"), async (req: Request, res: Response) => {
    try {
      const targetId = typeof req.body.agentId === "string" ? req.body.agentId.trim() : "";
      if (!targetId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }
      const agent = ctx.agents.get(targetId);
      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }

      // User ownership check (agents skip this — they act on behalf of their creator)
      if (req.user && req.user.role === "member" && agent.createdBy !== req.user.id) {
        res.status(403).json({ error: "You can only stop your own agents" });
        return;
      }

      // Project-scoped: agents in a project can only despawn agents in the same project
      if (req.agentCaller) {
        const callerProjectId = ctx.agents.get(req.agentCaller.agentId)?.projectId ?? null;
        if (callerProjectId && agent.projectId !== callerProjectId) {
          res.status(403).json({ error: "Agent not in your project" });
          return;
        }
      }

      agent.status = "stopping";
      updateAgentRunningState(targetId, "stopping");
      broadcastAgentList(ctx);
      try { await stopAgent(targetId); } catch { /* best effort */ }
      if (agent.ws && agent.ws.readyState === WebSocket.OPEN) {
        agent.ws.close();
      }
      ctx.agents.delete(targetId);
      softDeleteAgent(targetId);
      broadcastAgentList(ctx);
      for (const b of ctx.browsers) {
        if (b.watchingAgentId === targetId) {
          b.watchingAgentId = null;
          if (b.ws.readyState === WebSocket.OPEN) {
            b.ws.send(JSON.stringify({ type: "agent_stopped", agentId: targetId }));
          }
        }
      }
      logger.info("Agent despawned", { agentId: targetId, name: agent.name, source: "api" });
      res.json({ agentId: targetId, name: agent.name });
    } catch (err) {
      logger.error("Failed to despawn agent", { error: String(err) });
      res.status(500).json({ error: "Failed to despawn agent" });
    }
  });

  // ── Schedule endpoints ───────────────────────────────────────────────────

  // POST /api/schedules — users: admin/member; agents: requires agent:schedule
  router.post("/schedules", requireUserRoleOrAgentPermission(["admin", "member"], "agent:schedule"), (req: Request, res: Response) => {
    try {
      const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
      const cronExpression = typeof req.body.cron_expression === "string" ? req.body.cron_expression.trim() : "";
      const agentName = typeof req.body.agent_name === "string" ? req.body.agent_name.trim() : "";
      const agentPurpose = typeof req.body.agent_purpose === "string" ? req.body.agent_purpose.trim() : "";
      const agentSystemPrompt = typeof req.body.agent_system_prompt === "string" ? req.body.agent_system_prompt.trim() : "";
      const scheduleType = req.body.schedule_type === "once" ? "once" as const : "recurring" as const;

      if (!name) { res.status(400).json({ error: "name is required" }); return; }
      if (name.length > 255) { res.status(400).json({ error: "name must be 255 characters or less" }); return; }
      if (agentName.length > 255) { res.status(400).json({ error: "agent_name must be 255 characters or less" }); return; }
      if (agentPurpose.length > 1000) { res.status(400).json({ error: "agent_purpose must be 1000 characters or less" }); return; }
      if (agentSystemPrompt.length > 100000) { res.status(400).json({ error: "agent_system_prompt must be 100000 characters or less" }); return; }
      if (!cronExpression) { res.status(400).json({ error: "cron_expression is required" }); return; }
      if (getScheduleByName(name)) { res.status(409).json({ error: "A schedule with this name already exists" }); return; }
      try { CronExpressionParser.parse(cronExpression, { tz: "UTC" }); } catch {
        res.status(400).json({ error: "Invalid cron expression" }); return;
      }

      const userId = req.user?.id ?? null;
      const nextRunAt = (() => { try { return CronExpressionParser.parse(cronExpression, { tz: "UTC" }).next().toISOString(); } catch { return null; } })();
      const schedule = createSchedule(name, cronExpression, scheduleType, agentName, agentPurpose, agentSystemPrompt, nextRunAt, userId);
      broadcastScheduleList(ctx);
      res.status(201).json({ schedule });
    } catch (err) {
      logger.error("Failed to create schedule", { error: String(err) });
      res.status(500).json({ error: "Failed to create schedule" });
    }
  });

  // GET /api/schedules — users: all roles; agents: requires agent:schedule
  router.get("/schedules", requireAgentPermission("agent:schedule"), (req: Request, res: Response) => {
    try {
      const includeDeleted = req.query.include_deleted === "true";
      let schedules = getSchedules(includeDeleted);

      // Project-scoped: agents in a project can only see schedules in their project
      if (req.agentCaller) {
        const callerProjectId = ctx.agents.get(req.agentCaller.agentId)?.projectId ?? null;
        if (callerProjectId) {
          schedules = schedules.filter((s) => s.project_id === callerProjectId);
        }
      }

      res.json({ schedules });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/schedules/:id — users: all roles; agents: requires agent:schedule
  router.get("/schedules/:id", requireAgentPermission("agent:schedule"), (req: Request, res: Response) => {
    try {
      const schedule = getScheduleById(req.params.id as string);
      if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
      res.json({ schedule });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // PUT /api/schedules/:id — users: admin/member (ownership); agents: requires agent:schedule
  router.put("/schedules/:id", requireUserRoleOrAgentPermission(["admin", "member"], "agent:schedule"), (req: Request, res: Response) => {
    try {
      const existing = getScheduleById(req.params.id as string);
      if (!existing || existing.status === "deleted") { res.status(404).json({ error: "Schedule not found" }); return; }

      // User ownership check (agents skip this)
      if (req.user && req.user.role === "member" && existing.created_by !== req.user.id) {
        res.status(403).json({ error: "You can only modify your own schedules" });
        return;
      }

      const name = typeof req.body.name === "string" ? req.body.name.trim() : existing.name;
      const cronExpression = typeof req.body.cron_expression === "string" ? req.body.cron_expression.trim() : existing.cron_expression;
      const scheduleType = typeof req.body.schedule_type === "string" ? (req.body.schedule_type === "once" ? "once" as const : "recurring" as const) : existing.schedule_type;
      const agentName = typeof req.body.agent_name === "string" ? req.body.agent_name.trim() : existing.agent_name;
      const agentPurpose = typeof req.body.agent_purpose === "string" ? req.body.agent_purpose.trim() : existing.agent_purpose;
      const agentSystemPrompt = typeof req.body.agent_system_prompt === "string" ? req.body.agent_system_prompt.trim() : existing.agent_system_prompt;

      if (name.length > 255) { res.status(400).json({ error: "name must be 255 characters or less" }); return; }
      if (agentName.length > 255) { res.status(400).json({ error: "agent_name must be 255 characters or less" }); return; }
      if (agentPurpose.length > 1000) { res.status(400).json({ error: "agent_purpose must be 1000 characters or less" }); return; }
      if (agentSystemPrompt.length > 100000) { res.status(400).json({ error: "agent_system_prompt must be 100000 characters or less" }); return; }

      if (cronExpression !== existing.cron_expression) {
        try { CronExpressionParser.parse(cronExpression, { tz: "UTC" }); } catch {
          res.status(400).json({ error: "Invalid cron expression" }); return;
        }
      }

      const nextRunAt = (() => { try { return CronExpressionParser.parse(cronExpression, { tz: "UTC" }).next().toISOString(); } catch { return null; } })();
      const schedule = updateSchedule(req.params.id as string, name, cronExpression, scheduleType, agentName, agentPurpose, agentSystemPrompt, nextRunAt);
      broadcastScheduleList(ctx);
      res.json({ schedule });
    } catch (err) {
      logger.error("Failed to update schedule", { error: String(err) });
      res.status(500).json({ error: "Failed to update schedule" });
    }
  });

  // POST /api/schedules/:id/pause — users: admin/member (ownership); agents: requires agent:schedule
  router.post("/schedules/:id/pause", requireUserRoleOrAgentPermission(["admin", "member"], "agent:schedule"), (req: Request, res: Response) => {
    try {
      const existing = getScheduleById(req.params.id as string);
      if (!existing || existing.status === "deleted") { res.status(404).json({ error: "Schedule not found" }); return; }
      if (req.user && req.user.role === "member" && existing.created_by !== req.user.id) {
        res.status(403).json({ error: "You can only modify your own schedules" });
        return;
      }
      if (existing.status !== "active") { res.status(400).json({ error: "Only active schedules can be paused" }); return; }
      const schedule = setScheduleStatus(req.params.id as string, "paused");
      broadcastScheduleList(ctx);
      res.json({ schedule });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/schedules/:id/resume — users: admin/member (ownership); agents: requires agent:schedule
  router.post("/schedules/:id/resume", requireUserRoleOrAgentPermission(["admin", "member"], "agent:schedule"), (req: Request, res: Response) => {
    try {
      const existing = getScheduleById(req.params.id as string);
      if (!existing || existing.status === "deleted") { res.status(404).json({ error: "Schedule not found" }); return; }
      if (req.user && req.user.role === "member" && existing.created_by !== req.user.id) {
        res.status(403).json({ error: "You can only modify your own schedules" });
        return;
      }
      if (existing.status !== "paused") { res.status(400).json({ error: "Only paused schedules can be resumed" }); return; }
      const schedule = setScheduleStatus(req.params.id as string, "active");
      broadcastScheduleList(ctx);
      res.json({ schedule });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // DELETE /api/schedules/:id — users: admin/member (ownership); agents: requires agent:schedule
  router.delete("/schedules/:id", requireUserRoleOrAgentPermission(["admin", "member"], "agent:schedule"), (req: Request, res: Response) => {
    try {
      const existing = getScheduleById(req.params.id as string);
      if (!existing || existing.status === "deleted") { res.status(404).json({ error: "Schedule not found" }); return; }
      if (req.user && req.user.role === "member" && existing.created_by !== req.user.id) {
        res.status(403).json({ error: "You can only delete your own schedules" });
        return;
      }
      const schedule = setScheduleStatus(req.params.id as string, "deleted");
      broadcastScheduleList(ctx);
      res.json({ schedule });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
