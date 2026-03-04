import { WebSocket } from "ws";
import { CronExpressionParser } from "cron-parser";
import {
  createSchedule,
  getSchedules,
  getScheduleById,
  getScheduleByName,
  getActiveSchedules,
  markScheduleRun,
  updateSchedule,
  setScheduleStatus,
} from "./db.js";
import type { AppContext, BrowserClient } from "./communication.js";
import { makeAgentState, broadcastAgentList, broadcastScheduleList } from "./communication.js";
import { getProjectById } from "./db.js";
import { startAgent } from "./containers.js";
import { saveAgent, updateAgentRunningState } from "./db.js";
import { notifyScheduleTriggered } from "./push.js";
import { logger } from "./logger.js";

function computeNextRun(cronExpression: string): string | null {
  try {
    const expr = CronExpressionParser.parse(cronExpression, { tz: "UTC" });
    return expr.next().toISOString();
  } catch {
    return null;
  }
}

function isValidCron(cronExpression: string): boolean {
  try {
    CronExpressionParser.parse(cronExpression, { tz: "UTC" });
    return true;
  } catch {
    return false;
  }
}

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function canModifySchedule(client: BrowserClient | undefined, scheduleCreatedBy: number | null): boolean {
  if (!client || !client.userRole) return true; // no client = internal call, allow
  if (client.userRole === "viewer") return false;
  if (client.userRole === "admin") return true;
  return scheduleCreatedBy === client.userId;
}

function canCreateSchedule(client: BrowserClient | undefined): boolean {
  if (!client || !client.userRole) return true;
  return client.userRole === "admin" || client.userRole === "member";
}

export function handleScheduleMessage(ws: WebSocket, msg: Record<string, unknown>, broadcast?: () => void, client?: BrowserClient): boolean {
  switch (msg.type) {
    case "create_schedule": {
      if (!canCreateSchedule(client)) {
        send(ws, { type: "schedule_error", error: "Insufficient permissions to create schedules" });
        return true;
      }
      const name = typeof msg.name === "string" ? msg.name.trim() : "";
      const cronExpression = typeof msg.cron_expression === "string" ? msg.cron_expression.trim() : "";
      const agentName = typeof msg.agent_name === "string" ? msg.agent_name.trim() : "";
      const agentPurpose = typeof msg.agent_purpose === "string" ? msg.agent_purpose.trim() : "";
      const agentSystemPrompt = typeof msg.agent_system_prompt === "string" ? msg.agent_system_prompt.trim() : "";
      const scheduleType = msg.schedule_type === "once" ? "once" as const : "recurring" as const;

      if (!name || !cronExpression) {
        send(ws, { type: "schedule_error", error: "name and cron_expression are required" });
        return true;
      }
      if (getScheduleByName(name)) {
        send(ws, { type: "schedule_error", error: "A schedule with this name already exists" });
        return true;
      }
      if (!isValidCron(cronExpression)) {
        send(ws, { type: "schedule_error", error: "Invalid cron expression" });
        return true;
      }

      const agentPermissions = typeof msg.agent_permissions === "string" ? msg.agent_permissions.trim() : "";
      const projectId = typeof msg.project_id === "string" ? msg.project_id : null;

      const nextRunAt = computeNextRun(cronExpression);
      const createdBy = client?.userId ?? null;
      const schedule = createSchedule(name, cronExpression, scheduleType, agentName, agentPurpose, agentSystemPrompt, nextRunAt, createdBy, agentPermissions, projectId);
      send(ws, { type: "schedule_created", schedule });
      broadcast?.();
      return true;
    }

    case "list_schedules": {
      const includeDeleted = msg.include_deleted === true;
      const schedules = getSchedules(includeDeleted);
      send(ws, { type: "schedule_list", schedules });
      return true;
    }

    case "get_schedule": {
      const id = typeof msg.scheduleId === "string" ? msg.scheduleId : "";
      if (!id) {
        send(ws, { type: "schedule_error", error: "scheduleId is required" });
        return true;
      }
      const schedule = getScheduleById(id);
      if (!schedule) {
        send(ws, { type: "schedule_error", error: "Schedule not found" });
        return true;
      }
      send(ws, { type: "schedule_detail", schedule });
      return true;
    }

    case "update_schedule": {
      const id = typeof msg.scheduleId === "string" ? msg.scheduleId : "";
      if (!id) {
        send(ws, { type: "schedule_error", error: "scheduleId is required" });
        return true;
      }
      const existing = getScheduleById(id);
      if (!existing || existing.status === "deleted") {
        send(ws, { type: "schedule_error", error: "Schedule not found" });
        return true;
      }

      if (!canModifySchedule(client, existing.created_by)) {
        send(ws, { type: "schedule_error", error: "Insufficient permissions to modify this schedule" });
        return true;
      }

      const name = typeof msg.name === "string" ? msg.name.trim() : existing.name;
      const cronExpression = typeof msg.cron_expression === "string" ? msg.cron_expression.trim() : existing.cron_expression;
      const scheduleType = typeof msg.schedule_type === "string" ? (msg.schedule_type === "once" ? "once" as const : "recurring" as const) : existing.schedule_type;
      const agentName = typeof msg.agent_name === "string" ? msg.agent_name.trim() : existing.agent_name;
      const agentPurpose = typeof msg.agent_purpose === "string" ? msg.agent_purpose.trim() : existing.agent_purpose;
      const agentSystemPrompt = typeof msg.agent_system_prompt === "string" ? msg.agent_system_prompt.trim() : existing.agent_system_prompt;

      if (cronExpression !== existing.cron_expression && !isValidCron(cronExpression)) {
        send(ws, { type: "schedule_error", error: "Invalid cron expression" });
        return true;
      }

      const agentPermissions = typeof msg.agent_permissions === "string" ? msg.agent_permissions.trim() : existing.agent_permissions;

      const nextRunAt = computeNextRun(cronExpression);
      const schedule = updateSchedule(id, name, cronExpression, scheduleType, agentName, agentPurpose, agentSystemPrompt, nextRunAt, agentPermissions);
      send(ws, { type: "schedule_updated", schedule });
      broadcast?.();
      return true;
    }

    case "pause_schedule": {
      const id = typeof msg.scheduleId === "string" ? msg.scheduleId : "";
      if (!id) {
        send(ws, { type: "schedule_error", error: "scheduleId is required" });
        return true;
      }
      const existing = getScheduleById(id);
      if (!existing || existing.status === "deleted") {
        send(ws, { type: "schedule_error", error: "Schedule not found" });
        return true;
      }
      if (!canModifySchedule(client, existing.created_by)) {
        send(ws, { type: "schedule_error", error: "Insufficient permissions to modify this schedule" });
        return true;
      }
      if (existing.status !== "active") {
        send(ws, { type: "schedule_error", error: "Only active schedules can be paused" });
        return true;
      }
      const schedule = setScheduleStatus(id, "paused");
      send(ws, { type: "schedule_updated", schedule });
      broadcast?.();
      return true;
    }

    case "resume_schedule": {
      const id = typeof msg.scheduleId === "string" ? msg.scheduleId : "";
      if (!id) {
        send(ws, { type: "schedule_error", error: "scheduleId is required" });
        return true;
      }
      const existing = getScheduleById(id);
      if (!existing || existing.status === "deleted") {
        send(ws, { type: "schedule_error", error: "Schedule not found" });
        return true;
      }
      if (!canModifySchedule(client, existing.created_by)) {
        send(ws, { type: "schedule_error", error: "Insufficient permissions to modify this schedule" });
        return true;
      }
      if (existing.status !== "paused") {
        send(ws, { type: "schedule_error", error: "Only paused schedules can be resumed" });
        return true;
      }
      const schedule = setScheduleStatus(id, "active");
      send(ws, { type: "schedule_updated", schedule });
      broadcast?.();
      return true;
    }

    case "delete_schedule": {
      const id = typeof msg.scheduleId === "string" ? msg.scheduleId : "";
      if (!id) {
        send(ws, { type: "schedule_error", error: "scheduleId is required" });
        return true;
      }
      const existing = getScheduleById(id);
      if (!existing || existing.status === "deleted") {
        send(ws, { type: "schedule_error", error: "Schedule not found" });
        return true;
      }
      if (!canModifySchedule(client, existing.created_by)) {
        send(ws, { type: "schedule_error", error: "Insufficient permissions to delete this schedule" });
        return true;
      }
      const schedule = setScheduleStatus(id, "deleted");
      send(ws, { type: "schedule_deleted", schedule });
      broadcast?.();
      return true;
    }

    default:
      return false;
  }
}

// ── Schedule tick loop ───────────────────────────────────────────────────────

let tickInProgress = false;

async function tickSchedules(ctx: AppContext): Promise<void> {
  if (tickInProgress) return; // prevent overlapping ticks
  tickInProgress = true;
  try {
    await tickSchedulesInner(ctx);
  } finally {
    tickInProgress = false;
  }
}

async function tickSchedulesInner(ctx: AppContext): Promise<void> {
  const now = new Date();
  const schedules = getActiveSchedules();

  for (const schedule of schedules) {
    if (!schedule.next_run_at) continue;
    const nextRun = new Date(schedule.next_run_at);
    if (nextRun > now) continue;

    // Time to run this schedule — spawn an agent
    const agentName = schedule.agent_name || schedule.name;
    const managerUrl = `ws://${ctx.managerHost}:${ctx.port}/agent`;

    try {
      // Pass project's github token as extra env if schedule has a project
      let extraEnv = "";
      const scheduleProjectId = schedule.project_id ?? null;
      if (scheduleProjectId) {
        const project = getProjectById(scheduleProjectId);
        if (project && project.github_token) {
          extraEnv = `\nGITHUB_TOKEN=${project.github_token}\nGH_TOKEN=${project.github_token}`;
        }
      }
      const container = await startAgent(agentName, ctx.envFile, managerUrl, ctx.onAgentExit, extraEnv);
      const permissions = schedule.agent_permissions ? schedule.agent_permissions.split(",").filter(Boolean) : [];
      const state = makeAgentState(container.id, agentName, container.token, null, schedule.agent_purpose, schedule.agent_system_prompt, schedule.created_by, permissions, scheduleProjectId);
      ctx.agents.set(container.id, state);
      saveAgent(container.id, agentName, container.token, schedule.agent_purpose, schedule.agent_system_prompt, schedule.created_by, schedule.agent_permissions, scheduleProjectId);
      updateAgentRunningState(container.id, "starting");
      broadcastAgentList(ctx);
      notifyScheduleTriggered(schedule.name, agentName);
      logger.info("Schedule triggered", { scheduleId: schedule.id, scheduleName: schedule.name, agentId: container.id, agentName });
    } catch (err) {
      logger.error("Schedule failed to spawn agent", { scheduleId: schedule.id, scheduleName: schedule.name, error: String(err) });
    }

    // Compute next run and mark this run (auto-deletes "once" schedules)
    const nextRunAt = computeNextRun(schedule.cron_expression);
    markScheduleRun(schedule.id, nextRunAt);
  }

  broadcastScheduleList(ctx);
}

const TICK_INTERVAL_MS = 30_000; // check every 30 seconds

export function startScheduler(ctx: AppContext): NodeJS.Timeout {
  logger.info("Schedule ticker started", { intervalMs: TICK_INTERVAL_MS });
  const intervalId = setInterval(() => {
    tickSchedules(ctx).catch((err) => logger.error("Schedule tick error", { error: String(err) }));
  }, TICK_INTERVAL_MS);
  // Run immediately on startup
  tickSchedules(ctx).catch((err) => logger.error("Schedule tick error", { error: String(err) }));
  return intervalId;
}
