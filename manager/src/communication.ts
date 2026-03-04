import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { startAgent, stopAgent } from "./containers.js";
import { handleScheduleMessage } from "./schedules.js";
import { getSchedules, saveAgent, softDeleteAgent, getDeletedAgents, saveMessage, updateAgentTokens, updateAgentRunningState, loadMessages, hydrateMessages, getProjects, createProject, getProjectById, updateProject, updateProjectToken, deleteProject } from "./db.js";
import type { Project } from "./db.js";
import { notifyAgentAskUser, notifyAgentCompleted } from "./push.js";
import { logger } from "./logger.js";
import type { AuthPayload } from "./auth.js";
import type { UserRole } from "./db.js";

// ─── Shared types ──────────────────────────────────────────────────────────

export type TextEntry =
  | { role: "assistant" | "user"; text: string; type?: undefined; msgType?: string }
  | { role: "tool"; type: "tool_use"; toolType: string; name: string; input: unknown };

export type AgentState = {
  id: string;
  name: string;
  purpose: string;
  systemPrompt: string;
  token: string;
  status: "starting" | "running" | "stopping" | "stopped" | "deleted";
  processing: boolean;
  ws: WebSocket | null;
  textHistory: TextEntry[];
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  waitingForAskUser: boolean;
  pendingAskQuestions: unknown[] | null;
  createdBy: number | null;
  permissions: string[];
  projectId: string | null;
};

export type BrowserClient = {
  ws: WebSocket;
  watchingAgentId: string | null;
  userId: number | null;
  userRole: UserRole | null;
};

export type AppContext = {
  agents: Map<string, AgentState>;
  browsers: Set<BrowserClient>;
  envFile: string;
  managerHost: string;
  port: number;
  onAgentExit: (id: string, code: number | null) => void;
};

// ─── Auth ──────────────────────────────────────────────────────────────────

export function validateAgentToken(
  agents: Map<string, AgentState>,
  token: string,
): AgentState | null {
  const tokenBuf = Buffer.from(token);
  for (const agent of agents.values()) {
    const agentTokenBuf = Buffer.from(agent.token);
    if (tokenBuf.length === agentTokenBuf.length && timingSafeEqual(tokenBuf, agentTokenBuf)) {
      return agent;
    }
  }
  return null;
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function makeAgentState(
  id: string,
  name: string,
  token: string,
  ws: WebSocket | null,
  purpose = "",
  systemPrompt = "",
  createdBy: number | null = null,
  permissions: string[] = [],
  projectId: string | null = null,
): AgentState {
  return { id, name, purpose, systemPrompt, token, status: "starting", processing: false, ws, textHistory: [], costUSD: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, waitingForAskUser: false, pendingAskQuestions: null, createdBy, permissions, projectId };
}

export function broadcastAgentList(ctx: AppContext): void {
  const activeList = Array.from(ctx.agents.values()).map((a) => ({
    id: a.id,
    name: a.name,
    purpose: a.purpose,
    status: a.status,
    processing: a.processing,
    waitingForAskUser: a.waitingForAskUser,
    costUSD: a.costUSD,
    inputTokens: a.inputTokens,
    outputTokens: a.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens,
    createdBy: a.createdBy,
    permissions: a.permissions,
    projectId: a.projectId,
  }));

  // Include soft-deleted agents from database so their cost data persists in the UI
  const deletedList = getDeletedAgents().map((a) => ({
    id: a.id,
    name: a.name,
    purpose: a.purpose,
    status: "deleted" as const,
    processing: false,
    waitingForAskUser: false,
    costUSD: a.cost_usd,
    inputTokens: a.input_tokens,
    outputTokens: a.output_tokens,
    cacheReadInputTokens: a.cache_read_input_tokens,
    cacheCreationInputTokens: a.cache_creation_input_tokens,
    createdBy: a.created_by,
    permissions: a.permissions ? a.permissions.split(",").filter(Boolean) : [],
    projectId: a.project_id,
  }));

  const msg = JSON.stringify({ type: "agent_list", agents: [...activeList, ...deletedList] });
  for (const b of ctx.browsers) {
    if (b.ws.readyState === WebSocket.OPEN) {
      b.ws.send(msg);
    }
  }
}

export function broadcastToWatchers(ctx: AppContext, agentId: string, msg: unknown): void {
  const data = JSON.stringify(msg);
  for (const b of ctx.browsers) {
    if (b.watchingAgentId === agentId && b.ws.readyState === WebSocket.OPEN) {
      b.ws.send(data);
    }
  }
}

export function broadcastScheduleList(ctx: AppContext): void {
  const schedules = getSchedules(false);
  const msg = JSON.stringify({ type: "schedule_list", schedules });
  for (const b of ctx.browsers) {
    if (b.ws.readyState === WebSocket.OPEN) {
      b.ws.send(msg);
    }
  }
}

export function broadcastProjectList(ctx: AppContext): void {
  const projects = getProjects(false);
  // Mask github tokens: show only first 6 chars
  const masked = projects.map((p) => ({
    ...p,
    github_token: p.github_token ? p.github_token.slice(0, 6) + "******" : "",
  }));
  const msg = JSON.stringify({ type: "project_list", projects: masked });
  for (const b of ctx.browsers) {
    if (b.ws.readyState === WebSocket.OPEN) {
      b.ws.send(msg);
    }
  }
}

function sendMaskedProjectList(ws: WebSocket): void {
  const projects = getProjects(false);
  const masked = projects.map((p) => ({
    ...p,
    github_token: p.github_token ? p.github_token.slice(0, 6) + "******" : "",
  }));
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "project_list", projects: masked }));
  }
}

function canModifyProject(client: BrowserClient, project: Project): boolean {
  if (!client.userRole) return false;
  if (client.userRole === "viewer") return false;
  if (client.userRole === "admin") return true;
  return project.created_by === client.userId;
}

export function handleProjectMessage(ws: WebSocket, msg: Record<string, unknown>, ctx: AppContext, client: BrowserClient): boolean {
  switch (msg.type) {
    case "list_projects": {
      sendMaskedProjectList(ws);
      return true;
    }

    case "create_project": {
      if (client.userRole === "viewer") {
        ws.send(JSON.stringify({ type: "project_error", error: "Insufficient permissions" }));
        return true;
      }
      const name = typeof msg.name === "string" ? msg.name.trim() : "";
      const purpose = typeof msg.purpose === "string" ? msg.purpose.trim() : "";
      const githubToken = typeof msg.github_token === "string" ? msg.github_token.trim() : "";
      if (!name) {
        ws.send(JSON.stringify({ type: "project_error", error: "name is required" }));
        return true;
      }
      const project = createProject(name, purpose, githubToken, client.userId);
      const masked = { ...project, github_token: project.github_token ? project.github_token.slice(0, 6) + "******" : "" };
      ws.send(JSON.stringify({ type: "project_created", project: masked }));
      broadcastProjectList(ctx);
      return true;
    }

    case "update_project": {
      const id = typeof msg.projectId === "string" ? msg.projectId : "";
      if (!id) {
        ws.send(JSON.stringify({ type: "project_error", error: "projectId is required" }));
        return true;
      }
      const existing = getProjectById(id);
      if (!existing || existing.status === "deleted") {
        ws.send(JSON.stringify({ type: "project_error", error: "Project not found" }));
        return true;
      }
      if (!canModifyProject(client, existing)) {
        ws.send(JSON.stringify({ type: "project_error", error: "Insufficient permissions" }));
        return true;
      }
      const name = typeof msg.name === "string" ? msg.name.trim() : existing.name;
      const purpose = typeof msg.purpose === "string" ? msg.purpose.trim() : existing.purpose;
      const project = updateProject(id, name, purpose);
      if (typeof msg.github_token === "string") {
        updateProjectToken(id, msg.github_token.trim());
      }
      const updated = getProjectById(id)!;
      const masked = { ...updated, github_token: updated.github_token ? updated.github_token.slice(0, 6) + "******" : "" };
      ws.send(JSON.stringify({ type: "project_updated", project: masked }));
      broadcastProjectList(ctx);
      return true;
    }

    case "delete_project": {
      const id = typeof msg.projectId === "string" ? msg.projectId : "";
      if (!id) {
        ws.send(JSON.stringify({ type: "project_error", error: "projectId is required" }));
        return true;
      }
      const existing = getProjectById(id);
      if (!existing || existing.status === "deleted") {
        ws.send(JSON.stringify({ type: "project_error", error: "Project not found" }));
        return true;
      }
      if (!canModifyProject(client, existing)) {
        ws.send(JSON.stringify({ type: "project_error", error: "Insufficient permissions" }));
        return true;
      }
      deleteProject(id);
      ws.send(JSON.stringify({ type: "project_deleted", projectId: id }));
      broadcastProjectList(ctx);
      return true;
    }

    default:
      return false;
  }
}

// ─── Permission helpers ─────────────────────────────────────────────────────

function canModifyAgent(client: BrowserClient, agent: AgentState): boolean {
  if (!client.userRole) return false;
  if (client.userRole === "viewer") return false;
  if (client.userRole === "admin") return true;
  // member can only modify own agents
  return agent.createdBy === client.userId;
}

function canSpawn(client: BrowserClient): boolean {
  if (!client.userRole) return false;
  return client.userRole === "admin" || client.userRole === "member";
}

function canChat(client: BrowserClient, agent: AgentState): boolean {
  if (!client.userRole) return false;
  if (client.userRole === "viewer") return false;
  if (client.userRole === "admin") return true;
  return agent.createdBy === client.userId;
}

function canModifySchedule(client: BrowserClient, scheduleCreatedBy: number | null): boolean {
  if (!client.userRole) return false;
  if (client.userRole === "viewer") return false;
  if (client.userRole === "admin") return true;
  return scheduleCreatedBy === client.userId;
}

// ─── WebSocket servers ─────────────────────────────────────────────────────

export function setupWebSockets(
  server: Server,
  ctx: AppContext,
  verifyDashboardToken: (token: string) => AuthPayload | null,
): { agentWss: WebSocketServer; browserWss: WebSocketServer } {
  const agentWss = new WebSocketServer({ noServer: true });
  const browserWss = new WebSocketServer({ noServer: true });

  // ── Agent connections (/agent) ──────────────────────────────────────────

  agentWss.on("connection", (ws: WebSocket) => {
    let agentId: string | null = null;

    ws.on("message", async (data: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      // Registration — token must match the specific agent
      if (msg.type === "register" && typeof msg.agentId === "string" && typeof msg.token === "string") {
        agentId = msg.agentId;
        const agent = ctx.agents.get(agentId);
        if (!agent || agent.token !== msg.token) {
          logger.warn("Agent registration rejected", { agentId, reason: "invalid token" });
          ws.close(4001, "Invalid token");
          return;
        }
        agent.ws = ws;
        agent.status = "running";
        agent.processing = false;
        updateAgentRunningState(agentId, "running");
        broadcastAgentList(ctx);
        logger.info("Agent registered", { agentId });
        if (agent.systemPrompt) {
          ws.send(JSON.stringify({ type: "chat", message: agent.systemPrompt }));
        }
        return;
      }

      if (!agentId) return;
      const agent = ctx.agents.get(agentId);
      if (!agent) return;

      switch (msg.type) {
        case "output":
        case "tool_use":
        case "ask_user": {
          if (msg.type === "ask_user") {
            agent.waitingForAskUser = true;
            agent.pendingAskQuestions = (msg.questions as unknown[]) ?? [];
            agent.textHistory.push({ role: "tool", type: "tool_use", toolType: "ask_user", name: "AskUserQuestion", input: { questions: agent.pendingAskQuestions } });
            saveMessage(agentId, "assistant", "AskUserQuestion", { toolType: "ask_user", name: "AskUserQuestion", input: { questions: agent.pendingAskQuestions } });
            broadcastAgentList(ctx);
            notifyAgentAskUser(agent.name, agentId);
            const askNotif = JSON.stringify({ type: "ask_user_notification", agentId, agentName: agent.name });
            for (const b of ctx.browsers) {
              if (b.ws.readyState === WebSocket.OPEN) {
                b.ws.send(askNotif);
              }
            }
          } else if (msg.type === "tool_use") {
            if (msg.input === undefined || msg.input === null) break;
            if (msg.toolType !== undefined && typeof msg.toolType !== "string") break;
            if (msg.name !== undefined && typeof msg.name !== "string") break;
            const toolType = (typeof msg.toolType === "string" && msg.toolType) || "tool_use";
            const toolName = (typeof msg.name === "string" && msg.name) || "";
            const toolInput = msg.input;
            agent.textHistory.push({ role: "tool", type: "tool_use", toolType, name: toolName, input: toolInput });
            saveMessage(agentId, "assistant", toolName, { toolType, name: toolName, input: toolInput });
          } else {
            const msgType = msg.msgType;
            const content = msg.content;
            if (typeof msgType !== "string" || typeof content !== "string") break;
            if (msgType === "user_input") {
              agent.textHistory.push({ role: "user", text: content });
              saveMessage(agentId, "user", content);
            } else {
              agent.textHistory.push({ role: "assistant", text: content, msgType });
              saveMessage(agentId, "assistant", content, { msgType });
            }
          }
          broadcastToWatchers(ctx, agentId, msg);
          break;
        }

        case "tokens": {
          const t = msg.tokens as { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUSD?: number };
          // SDK values are cumulative totals, so assign (=) instead of accumulate (+=)
          if (typeof t.costUSD === "number" && t.costUSD >= 0) agent.costUSD = t.costUSD;
          if (typeof t.inputTokens === "number" && t.inputTokens >= 0) agent.inputTokens = t.inputTokens;
          if (typeof t.outputTokens === "number" && t.outputTokens >= 0) agent.outputTokens = t.outputTokens;
          if (typeof t.cacheReadInputTokens === "number" && t.cacheReadInputTokens >= 0) agent.cacheReadInputTokens = t.cacheReadInputTokens;
          if (typeof t.cacheCreationInputTokens === "number" && t.cacheCreationInputTokens >= 0) agent.cacheCreationInputTokens = t.cacheCreationInputTokens;
          updateAgentTokens(agentId, agent.costUSD, agent.inputTokens, agent.outputTokens, agent.cacheReadInputTokens, agent.cacheCreationInputTokens);
          broadcastToWatchers(ctx, agentId, msg);
          broadcastAgentList(ctx);
          break;
        }

        case "status": {
          if (typeof msg.status !== "string") break;
          const status = msg.status;
          const wasProcessing = agent.processing;
          agent.processing = status.toLowerCase().includes("thinking");
          if (wasProcessing !== agent.processing) {
            broadcastAgentList(ctx);
          }
          broadcastToWatchers(ctx, agentId, msg);
          break;
        }

        case "agent_status": {
          if (typeof msg.agentId !== "string" || typeof msg.status !== "string") break;
          const validStatuses: AgentState["status"][] = ["starting", "running", "stopping", "stopped"];
          if (!validStatuses.includes(msg.status as AgentState["status"])) break;
          const targetId = msg.agentId;
          const targetAgent = ctx.agents.get(targetId);
          if (targetAgent) {
            targetAgent.status = msg.status as AgentState["status"];
            broadcastAgentList(ctx);
          }
          break;
        }

        case "spawn_agent": {
          // Check agent:spawn permission
          if (!agent.permissions.includes("agent:spawn")) {
            ws.send(JSON.stringify({ type: "spawn_error", error: "Agent lacks permission: agent:spawn" }));
            break;
          }
          const name = (typeof msg.name === "string" && msg.name.trim()) || "Untitled Agent";
          const purpose = (typeof msg.purpose === "string" && msg.purpose.trim()) || "";
          const systemPrompt = (typeof msg.systemPrompt === "string" && msg.systemPrompt.trim()) || "";
          if (name.length > 255 || purpose.length > 1000 || systemPrompt.length > 100000) break;
          // Child agents inherit parent's project
          const childProjectId = agent.projectId;
          let extraEnv = "";
          if (childProjectId) {
            const project = getProjectById(childProjectId);
            if (project && project.github_token) {
              extraEnv = `\nGITHUB_TOKEN=${project.github_token}\nGH_TOKEN=${project.github_token}`;
            }
          }
          const managerUrl = `ws://${ctx.managerHost}:${ctx.port}/agent`;
          try {
            const container = await startAgent(name, ctx.envFile, managerUrl, ctx.onAgentExit, extraEnv);
            // Child agents inherit parent permissions and project
            const childPermissions = agent.permissions;
            const state = makeAgentState(container.id, name, container.token, null, purpose, systemPrompt, agent.createdBy, childPermissions, childProjectId);
            ctx.agents.set(container.id, state);
            saveAgent(container.id, name, container.token, purpose, systemPrompt, agent.createdBy, childPermissions.join(","), childProjectId);
            updateAgentRunningState(container.id, "starting");
            broadcastAgentList(ctx);
            logger.info("Agent spawned", { agentId: container.id, name, spawnedBy: agentId, projectId: childProjectId });
            ws.send(JSON.stringify({ type: "agent_spawned", agentId: container.id, name }));
          } catch (err) {
            ws.send(JSON.stringify({ type: "spawn_error", error: `${err}` }));
          }
          break;
        }
      }
    });

    ws.on("close", () => {
      if (agentId) {
        const agent = ctx.agents.get(agentId);
        if (agent) {
          agent.ws = null;
          agent.status = "stopped";
          agent.processing = false;
          updateAgentRunningState(agentId, "stopped");
          broadcastAgentList(ctx);
          notifyAgentCompleted(agent.name, agentId);
          logger.info("Agent disconnected", { agentId });
        }
      }
    });
  });

  // ── Browser connections (/ws) ───────────────────────────────────────────

  browserWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    // Extract user info from the JWT that was verified during upgrade
    let userId: number | null = null;
    let userRole: UserRole | null = null;
    const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const token = reqUrl.searchParams.get("token");
    if (token) {
      const payload = verifyDashboardToken(token);
      if (payload) {
        userId = payload.sub;
        userRole = payload.role;
      }
    }

    const client: BrowserClient = { ws, watchingAgentId: null, userId, userRole };
    ctx.browsers.add(client);

    const activeList = Array.from(ctx.agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
      purpose: a.purpose,
      status: a.status,
      processing: a.processing,
      waitingForAskUser: a.waitingForAskUser,
      costUSD: a.costUSD,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      cacheReadInputTokens: a.cacheReadInputTokens,
      cacheCreationInputTokens: a.cacheCreationInputTokens,
      createdBy: a.createdBy,
      permissions: a.permissions,
      projectId: a.projectId,
    }));
    const deletedList = getDeletedAgents().map((a) => ({
      id: a.id,
      name: a.name,
      purpose: a.purpose,
      status: "deleted" as const,
      processing: false,
      waitingForAskUser: false,
      costUSD: a.cost_usd,
      inputTokens: a.input_tokens,
      outputTokens: a.output_tokens,
      cacheReadInputTokens: a.cache_read_input_tokens,
      cacheCreationInputTokens: a.cache_creation_input_tokens,
      createdBy: a.created_by,
      permissions: a.permissions ? a.permissions.split(",").filter(Boolean) : [],
      projectId: a.project_id,
    }));
    ws.send(JSON.stringify({ type: "agent_list", agents: [...activeList, ...deletedList] }));

    // Send initial schedule list
    const schedules = getSchedules(false);
    ws.send(JSON.stringify({ type: "schedule_list", schedules }));

    // Send initial project list
    sendMaskedProjectList(ws);

    ws.on("message", async (data: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (handleScheduleMessage(ws, msg, () => broadcastScheduleList(ctx), client)) return;
      if (handleProjectMessage(ws, msg, ctx, client)) return;

      switch (msg.type) {
        case "start_agent": {
          if (!canSpawn(client)) {
            ws.send(JSON.stringify({ type: "error", message: "Insufficient permissions to spawn agents" }));
            break;
          }
          const name = (typeof msg.name === "string" && msg.name.trim()) || "Untitled Agent";
          if (name.length > 255) break;
          const purpose = typeof msg.purpose === "string" ? msg.purpose.trim() : "";
          if (purpose.length > 1000) break;
          // Parse permissions from the message (array of permission strings)
          const agentPermissions: string[] = Array.isArray(msg.permissions)
            ? (msg.permissions as unknown[]).filter((p): p is string => typeof p === "string")
            : [];
          const systemPrompt = typeof msg.systemPrompt === "string" ? msg.systemPrompt.trim() : "";
          if (systemPrompt.length > 100000) break;
          const projectId = typeof msg.projectId === "string" ? msg.projectId : null;
          // If project specified, look up github token to pass to agent
          let extraEnv = "";
          if (projectId) {
            const project = getProjectById(projectId);
            if (project && project.github_token) {
              extraEnv = `\nGITHUB_TOKEN=${project.github_token}\nGH_TOKEN=${project.github_token}`;
            }
          }
          const managerUrl = `ws://${ctx.managerHost}:${ctx.port}/agent`;
          try {
            const container = await startAgent(name, ctx.envFile, managerUrl, ctx.onAgentExit, extraEnv);
            const state = makeAgentState(container.id, name, container.token, null, purpose, systemPrompt, client.userId, agentPermissions, projectId);
            ctx.agents.set(container.id, state);
            saveAgent(container.id, name, container.token, purpose, systemPrompt, client.userId, agentPermissions.join(","), projectId);
            updateAgentRunningState(container.id, "starting");
            broadcastAgentList(ctx);
            logger.info("Agent spawned", { agentId: container.id, name, source: "dashboard", userId: client.userId, projectId });
          } catch (err) {
            ws.send(JSON.stringify({ type: "error", message: `Failed to start agent: ${err}` }));
          }
          break;
        }

        case "stop_agent": {
          const agentId = msg.agentId as string;
          const agent = ctx.agents.get(agentId);
          if (agent) {
            if (!canModifyAgent(client, agent)) {
              ws.send(JSON.stringify({ type: "error", message: "Insufficient permissions to stop this agent" }));
              break;
            }
            if (agent.status === "stopping") break;
            agent.status = "stopping";
            updateAgentRunningState(agentId, "stopping");
            broadcastAgentList(ctx);
            try { await stopAgent(agentId); } catch { /* best effort */ }
            if (agent.ws && agent.ws.readyState === WebSocket.OPEN) {
              agent.ws.close();
            }
            ctx.agents.delete(agentId);
            softDeleteAgent(agentId);
            broadcastAgentList(ctx);
            for (const b of ctx.browsers) {
              if (b.watchingAgentId === agentId) {
                b.watchingAgentId = null;
                if (b.ws.readyState === WebSocket.OPEN) {
                  b.ws.send(JSON.stringify({ type: "agent_stopped", agentId }));
                }
              }
            }
            logger.info("Agent stopped", { agentId, reason: "manual" });
          }
          break;
        }

        case "stop_agents": {
          const agentIds = msg.agentIds;
          if (!Array.isArray(agentIds)) break;

          // Collect stoppable agents and mark all as "stopping" in one pass
          const toStop: AgentState[] = [];
          for (const id of agentIds) {
            if (typeof id !== "string") continue;
            const agent = ctx.agents.get(id);
            if (agent && agent.status !== "stopping" && agent.status !== "stopped" && agent.status !== "deleted") {
              if (!canModifyAgent(client, agent)) continue; // skip agents user can't stop
              agent.status = "stopping";
              updateAgentRunningState(id, "stopping");
              toStop.push(agent);
            }
          }
          if (toStop.length === 0) break;

          broadcastAgentList(ctx);

          for (const agent of toStop) {
            try { await stopAgent(agent.id); } catch { /* best effort */ }
            if (agent.ws && agent.ws.readyState === WebSocket.OPEN) {
              agent.ws.close();
            }
            ctx.agents.delete(agent.id);
            softDeleteAgent(agent.id);
            for (const b of ctx.browsers) {
              if (b.watchingAgentId === agent.id) {
                b.watchingAgentId = null;
                if (b.ws.readyState === WebSocket.OPEN) {
                  b.ws.send(JSON.stringify({ type: "agent_stopped", agentId: agent.id }));
                }
              }
            }
          }

          broadcastAgentList(ctx);
          logger.info("Agents batch stopped", { count: toStop.length, agentIds: toStop.map(a => a.id) });
          break;
        }

        case "watch": {
          const agentId = msg.agentId as string;
          client.watchingAgentId = agentId;
          const agent = ctx.agents.get(agentId);
          if (agent) {
            ws.send(JSON.stringify({
              type: "text_history",
              agentId,
              entries: agent.textHistory,
            }));
            // If agent is waiting for user input, re-send the ask_user message
            if (agent.waitingForAskUser && agent.pendingAskQuestions) {
              ws.send(JSON.stringify({
                type: "ask_user",
                agentId,
                questions: agent.pendingAskQuestions,
              }));
            }
          } else {
            // Agent not in memory (deleted/stopped) — load persisted history from DB
            const messages = loadMessages(agentId);
            const entries = hydrateMessages(messages);
            ws.send(JSON.stringify({
              type: "text_history",
              agentId,
              entries,
            }));
          }
          break;
        }

        case "ask_user_response": {
          if (typeof msg.agentId !== "string" || !msg.answers || typeof msg.answers !== "object") break;
          const agentId = msg.agentId;
          const agent = ctx.agents.get(agentId);
          if (!agent) break;
          if (!canChat(client, agent)) {
            ws.send(JSON.stringify({ type: "error", message: "Insufficient permissions to respond to this agent" }));
            break;
          }
          if (agent.ws && agent.ws.readyState === WebSocket.OPEN) {
            agent.waitingForAskUser = false;
            agent.pendingAskQuestions = null;
            agent.ws.send(JSON.stringify({ type: "ask_user_response", answers: msg.answers }));
            broadcastAgentList(ctx);
          }
          break;
        }

        case "chat": {
          if (typeof msg.agentId !== "string" || typeof msg.message !== "string") break;
          if (msg.message.length > 50000) break;
          const agentId = msg.agentId;
          const message = msg.message;
          const agent = ctx.agents.get(agentId);
          if (!agent) break;
          if (!canChat(client, agent)) {
            ws.send(JSON.stringify({ type: "error", message: "Insufficient permissions to chat with this agent" }));
            break;
          }
          if (agent.ws && agent.ws.readyState === WebSocket.OPEN) {
            agent.ws.send(JSON.stringify({ type: "chat", message }));
            agent.textHistory.push({ role: "user", text: message });
            saveMessage(agentId, "user", message);
            broadcastToWatchers(ctx, agentId, {
              type: "output",
              agentId,
              msgType: "user_input",
              content: message,
            });
          }
          break;
        }

        case "reload_service": {
          // Only admins can reload the service
          if (client.userRole !== "admin") {
            ws.send(JSON.stringify({ type: "error", message: "Only admins can reload the service" }));
            break;
          }
          const installScript = join(fileURLToPath(import.meta.url), "..", "..", "..", "install.sh");
          ws.send(JSON.stringify({ type: "reload_started" }));
          logger.info("Reload requested", { script: "install.sh" });
          const child = spawn("bash", [installScript], {
            detached: true,
            stdio: "ignore",
          });
          child.unref();
          break;
        }
      }
    });

    ws.on("close", () => {
      ctx.browsers.delete(client);
    });
  });

  // ── Upgrade handler ─────────────────────────────────────────────────────

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "/";
    if (url === "/agent") {
      agentWss.handleUpgrade(req, socket, head, (ws) => {
        agentWss.emit("connection", ws, req);
      });
    } else if (url.startsWith("/ws")) {
      // Validate JWT from query param: /ws?token=xxx
      const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const token = reqUrl.searchParams.get("token");
      if (!token || !verifyDashboardToken(token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      browserWss.handleUpgrade(req, socket, head, (ws) => {
        browserWss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  return { agentWss, browserWss };
}
