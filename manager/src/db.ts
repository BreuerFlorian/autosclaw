import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { hashSync, compareSync } from "bcryptjs";
import { env } from "./env.js";
import { logger } from "./logger.js";

// ─── Database setup ──────────────────────────────────────────────────────────

const dataDir = join(fileURLToPath(import.meta.url), "..", "..", "data");
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, "autosclaw.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member','viewer')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    id                          TEXT PRIMARY KEY,
    name                        TEXT NOT NULL,
    token                       TEXT NOT NULL,
    purpose                     TEXT NOT NULL DEFAULT '',
    system_prompt               TEXT NOT NULL DEFAULT '',
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    cost_usd                    REAL    NOT NULL DEFAULT 0.0,
    input_tokens                INTEGER NOT NULL DEFAULT 0,
    output_tokens               INTEGER NOT NULL DEFAULT 0,
    cache_read_input_tokens     INTEGER NOT NULL DEFAULT 0,
    cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
    status                      TEXT NOT NULL DEFAULT 'active',
    deleted_at                  TEXT,
    running_state               TEXT NOT NULL DEFAULT 'stopped',
    created_by                  INTEGER,
    permissions                 TEXT NOT NULL DEFAULT '',
    project_id                  TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   TEXT    NOT NULL,
    role       TEXT    NOT NULL CHECK (role IN ('assistant', 'user')),
    msg_type   TEXT    NOT NULL DEFAULT 'text' CHECK (msg_type IN ('text', 'tool_use')),
    text       TEXT    NOT NULL,
    metadata   TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_agent_id ON messages (agent_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS schedules (
    id                  TEXT    PRIMARY KEY,
    name                TEXT    NOT NULL,
    cron_expression     TEXT    NOT NULL,
    schedule_type       TEXT    NOT NULL DEFAULT 'recurring' CHECK (schedule_type IN ('recurring', 'once')),
    agent_name          TEXT    NOT NULL DEFAULT '',
    agent_purpose       TEXT    NOT NULL DEFAULT '',
    agent_system_prompt TEXT    NOT NULL DEFAULT '',
    status              TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
    last_run_at         TEXT,
    next_run_at         TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    created_by          INTEGER,
    agent_permissions   TEXT    NOT NULL DEFAULT '',
    project_id          TEXT
  );
`);

// Unique index on schedule name for non-deleted schedules (prevents race condition on check-then-insert)
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_name_active ON schedules (name) WHERE status != 'deleted'`);
} catch {
  // Index already exists or partial indexes not supported
}

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    purpose     TEXT    NOT NULL DEFAULT '',
    github_token TEXT   NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    created_by  INTEGER
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    endpoint    TEXT    NOT NULL UNIQUE,
    keys_p256dh TEXT    NOT NULL,
    keys_auth   TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Types ───────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "member" | "viewer";

export type User = {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
};

export type Schedule = {
  id: string;
  name: string;
  cron_expression: string;
  schedule_type: "recurring" | "once";
  agent_name: string;
  agent_purpose: string;
  agent_system_prompt: string;
  agent_permissions: string;
  status: "active" | "paused" | "deleted";
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: number | null;
  project_id: string | null;
};

export type Project = {
  id: string;
  name: string;
  purpose: string;
  github_token: string;
  status: "active" | "deleted";
  created_at: string;
  updated_at: string;
  created_by: number | null;
};

// ─── Prepared statements ─────────────────────────────────────────────────────

const findByUsername = db.prepare("SELECT * FROM users WHERE username = ?");
const findUserById = db.prepare("SELECT * FROM users WHERE id = ?");
const selectAllUsers = db.prepare("SELECT id, username, role, created_at FROM users ORDER BY id");
const insertUser = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)");
const updateUserRoleStmt = db.prepare("UPDATE users SET role = ? WHERE id = ?");
const getConfig = db.prepare("SELECT value FROM config WHERE key = ?");
const setConfig = db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)");
const insertAgent = db.prepare("INSERT OR REPLACE INTO agents (id, name, token, purpose, system_prompt, created_by, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)");
const deleteAgent = db.prepare("DELETE FROM agents WHERE id = ?");
const selectActiveAgents = db.prepare("SELECT * FROM agents WHERE status = 'active'");
const selectAllAgentsIncludingDeleted = db.prepare("SELECT * FROM agents ORDER BY created_at");
const selectDeletedAgents = db.prepare("SELECT * FROM agents WHERE status = 'deleted' ORDER BY deleted_at DESC");
const deleteAllAgents = db.prepare("DELETE FROM agents");
const softDeleteAgentStmt = db.prepare("UPDATE agents SET status = 'deleted', deleted_at = datetime('now') WHERE id = ?");

const updateAgentTokensStmt = db.prepare(`
  UPDATE agents SET cost_usd = ?, input_tokens = ?, output_tokens = ?, cache_read_input_tokens = ?, cache_creation_input_tokens = ? WHERE id = ?
`);

const updateAgentRunningStateStmt = db.prepare("UPDATE agents SET running_state = ? WHERE id = ? AND status = 'active'");

const insertMessage = db.prepare("INSERT INTO messages (agent_id, role, text) VALUES (?, ?, ?)");
const insertMessageWithMeta = db.prepare("INSERT INTO messages (agent_id, role, text, metadata) VALUES (?, ?, ?, ?)");
const insertToolMessage = db.prepare("INSERT INTO messages (agent_id, role, msg_type, text, metadata) VALUES (?, 'assistant', 'tool_use', ?, ?)");
const selectMessagesByAgent = db.prepare("SELECT role, msg_type, text, metadata FROM messages WHERE agent_id = ? ORDER BY id ASC");
const deleteMessagesByAgent = db.prepare("DELETE FROM messages WHERE agent_id = ?");

const insertSchedule = db.prepare(`
  INSERT INTO schedules (id, name, cron_expression, schedule_type, agent_name, agent_purpose, agent_system_prompt, next_run_at, created_by, agent_permissions)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const findScheduleByName = db.prepare("SELECT * FROM schedules WHERE name = ? AND status != 'deleted'");
const listSchedules = db.prepare("SELECT * FROM schedules WHERE status != 'deleted' ORDER BY id");
const listAllSchedules = db.prepare("SELECT * FROM schedules ORDER BY id");
const findScheduleById = db.prepare("SELECT * FROM schedules WHERE id = ?");
const updateScheduleStmt = db.prepare(`
  UPDATE schedules
  SET name = ?, cron_expression = ?, schedule_type = ?, agent_name = ?, agent_purpose = ?, agent_system_prompt = ?, next_run_at = ?, agent_permissions = ?, updated_at = datetime('now')
  WHERE id = ?
`);
const updateScheduleStatus = db.prepare("UPDATE schedules SET status = ?, updated_at = datetime('now') WHERE id = ?");
const updateScheduleLastRun = db.prepare("UPDATE schedules SET last_run_at = datetime('now'), next_run_at = ?, updated_at = datetime('now') WHERE id = ?");
const listActiveSchedules = db.prepare("SELECT * FROM schedules WHERE status = 'active' ORDER BY id");

const insertPushSubscription = db.prepare(`
  INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?, ?)
`);
const selectPushSubscriptionsByUser = db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ?");
const selectAllPushSubscriptions = db.prepare("SELECT * FROM push_subscriptions");
const deletePushSubscriptionByEndpoint = db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");

// ─── Public API ──────────────────────────────────────────────────────────────

export function getUserByUsername(username: string): User | undefined {
  return findByUsername.get(username) as User | undefined;
}

export function createUser(username: string, password: string, role: UserRole = "member"): User {
  const hash = hashSync(password, 10);
  const result = insertUser.run(username, hash, role);
  return { id: Number(result.lastInsertRowid), username, password_hash: hash, role, created_at: new Date().toISOString() };
}

export function getUserById(id: number): User | undefined {
  return findUserById.get(id) as User | undefined;
}

export function listUsers(): Array<{ id: number; username: string; role: UserRole; created_at: string }> {
  return selectAllUsers.all() as Array<{ id: number; username: string; role: UserRole; created_at: string }>;
}

export function updateUserRole(userId: number, role: UserRole): boolean {
  const result = updateUserRoleStmt.run(role, userId);
  return result.changes > 0;
}

export function verifyPassword(user: User, password: string): boolean {
  return compareSync(password, user.password_hash);
}

export function getConfigValue(key: string): string | undefined {
  const row = getConfig.get(key) as { value: string } | undefined;
  return row?.value;
}

export function setConfigValue(key: string, value: string): void {
  setConfig.run(key, value);
}

// ─── Agent persistence ──────────────────────────────────────────────────────

export type PersistedAgent = {
  id: string;
  name: string;
  token: string;
  purpose: string;
  system_prompt: string;
  created_at: string;
  status: "active" | "deleted";
  deleted_at: string | null;
  running_state: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  created_by: number | null;
  permissions: string;
  project_id: string | null;
};

export function saveAgent(id: string, name: string, token: string, purpose: string, systemPrompt: string, createdBy?: number | null, permissions?: string, projectId?: string | null): void {
  insertAgent.run(id, name, token, purpose, systemPrompt, createdBy ?? null, permissions ?? "");
  if (projectId) {
    db.prepare("UPDATE agents SET project_id = ? WHERE id = ?").run(projectId, id);
  }
}

export function removeAgent(id: string): void {
  deleteAgent.run(id);
}

export function softDeleteAgent(id: string): void {
  softDeleteAgentStmt.run(id);
}

export function loadAllAgents(): PersistedAgent[] {
  return selectActiveAgents.all() as PersistedAgent[];
}

export function getDeletedAgents(): PersistedAgent[] {
  return selectDeletedAgents.all() as PersistedAgent[];
}

export function getAgents(includeDeleted: boolean): PersistedAgent[] {
  return (includeDeleted ? selectAllAgentsIncludingDeleted.all() : selectActiveAgents.all()) as PersistedAgent[];
}

export function clearAllAgents(): void {
  deleteAllAgents.run();
}

export function updateAgentRunningState(id: string, state: string): void {
  updateAgentRunningStateStmt.run(state, id);
}

export function updateAgentTokens(
  id: string,
  costUSD: number,
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens: number,
  cacheCreationInputTokens: number,
): void {
  updateAgentTokensStmt.run(costUSD, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, id);
}

// ─── Message persistence ─────────────────────────────────────────────────────

export type PersistedMessage = {
  role: "assistant" | "user";
  msg_type: "text" | "tool_use";
  text: string;
  metadata: string | null;
};

export function saveMessage(agentId: string, role: "assistant" | "user", text: string, metadata?: Record<string, unknown>): void {
  if (!metadata) {
    insertMessage.run(agentId, role, text);
  } else if ("toolType" in metadata) {
    insertToolMessage.run(agentId, text, JSON.stringify(metadata));
  } else {
    insertMessageWithMeta.run(agentId, role, text, JSON.stringify(metadata));
  }
}

export function loadMessages(agentId: string): PersistedMessage[] {
  return selectMessagesByAgent.all(agentId) as PersistedMessage[];
}

export function deleteMessages(agentId: string): void {
  deleteMessagesByAgent.run(agentId);
}

export type HydratedEntry =
  | { role: "assistant" | "user"; text: string; type?: undefined; msgType?: string }
  | { role: "tool"; type: "tool_use"; toolType: string; name: string; input: unknown };

export function hydrateMessages(rows: PersistedMessage[]): HydratedEntry[] {
  return rows.map((r): HydratedEntry => {
    if (r.msg_type === "tool_use" && r.metadata) {
      try {
        const meta = JSON.parse(r.metadata) as { toolType: string; name: string; input: unknown };
        return { role: "tool", type: "tool_use", toolType: meta.toolType, name: meta.name, input: meta.input };
      } catch { /* fall through to text */ }
    }
    if (r.metadata) {
      try {
        const meta = JSON.parse(r.metadata) as { msgType?: string };
        if (meta.msgType) {
          return { role: r.role, text: r.text, msgType: meta.msgType };
        }
      } catch { /* ignore */ }
    }
    return { role: r.role, text: r.text };
  });
}

// ─── Schedule functions ──────────────────────────────────────────────────────

export function createSchedule(
  name: string,
  cronExpression: string,
  scheduleType: "recurring" | "once",
  agentName: string,
  agentPurpose: string,
  agentSystemPrompt: string,
  nextRunAt: string | null,
  createdBy?: number | null,
  agentPermissions?: string,
  projectId?: string | null,
): Schedule {
  const id = randomUUID();
  insertSchedule.run(id, name, cronExpression, scheduleType, agentName, agentPurpose, agentSystemPrompt, nextRunAt, createdBy ?? null, agentPermissions ?? "");
  if (projectId) {
    db.prepare("UPDATE schedules SET project_id = ? WHERE id = ?").run(projectId, id);
  }
  return getScheduleById(id)!;
}

export function getSchedules(includeDeleted: boolean): Schedule[] {
  return (includeDeleted ? listAllSchedules.all() : listSchedules.all()) as Schedule[];
}

export function getScheduleById(id: string): Schedule | undefined {
  return findScheduleById.get(id) as Schedule | undefined;
}

export function getScheduleByName(name: string): Schedule | undefined {
  return findScheduleByName.get(name) as Schedule | undefined;
}

export function updateSchedule(
  id: string,
  name: string,
  cronExpression: string,
  scheduleType: "recurring" | "once",
  agentName: string,
  agentPurpose: string,
  agentSystemPrompt: string,
  nextRunAt: string | null,
  agentPermissions?: string,
): Schedule | undefined {
  updateScheduleStmt.run(name, cronExpression, scheduleType, agentName, agentPurpose, agentSystemPrompt, nextRunAt, agentPermissions ?? "", id);
  return getScheduleById(id);
}

export function setScheduleStatus(id: string, status: "active" | "paused" | "deleted"): Schedule | undefined {
  updateScheduleStatus.run(status, id);
  return getScheduleById(id);
}

export function markScheduleRun(id: string, nextRunAt: string | null): void {
  updateScheduleLastRun.run(nextRunAt, id);
  const schedule = getScheduleById(id);
  if (schedule?.schedule_type === "once") {
    setScheduleStatus(id, "deleted");
  }
}

export function getActiveSchedules(): Schedule[] {
  return listActiveSchedules.all() as Schedule[];
}

export function checkDatabase(): "connected" | "error" {
  try {
    db.prepare("SELECT 1").get();
    return "connected";
  } catch {
    return "error";
  }
}

/** Close the database connection. */
export function closeDatabase(): void {
  db.close();
}

/**
 * Seed admin user from ADMIN_USERNAME / ADMIN_PASSWORD env vars.
 * Idempotent — no-ops if the user already exists.
 */
// ─── Push subscription persistence ───────────────────────────────────────────

export type PushSubscriptionRow = {
  id: number;
  user_id: number;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
  created_at: string;
};

export function savePushSubscription(userId: number, endpoint: string, keysP256dh: string, keysAuth: string): void {
  insertPushSubscription.run(userId, endpoint, keysP256dh, keysAuth);
}

export function getPushSubscriptions(userId: number): PushSubscriptionRow[] {
  return selectPushSubscriptionsByUser.all(userId) as PushSubscriptionRow[];
}

export function getAllPushSubscriptions(): PushSubscriptionRow[] {
  return selectAllPushSubscriptions.all() as PushSubscriptionRow[];
}

export function deletePushSubscription(endpoint: string): void {
  deletePushSubscriptionByEndpoint.run(endpoint);
}

// ─── Project functions ───────────────────────────────────────────────────

const insertProject = db.prepare(`
  INSERT INTO projects (id, name, purpose, github_token, created_by) VALUES (?, ?, ?, ?, ?)
`);
const selectActiveProjects = db.prepare("SELECT * FROM projects WHERE status = 'active' ORDER BY created_at DESC");
const selectAllProjects = db.prepare("SELECT * FROM projects ORDER BY created_at DESC");
const findProjectById = db.prepare("SELECT * FROM projects WHERE id = ?");
const updateProjectStmt = db.prepare(`
  UPDATE projects SET name = ?, purpose = ?, updated_at = datetime('now') WHERE id = ? AND status = 'active'
`);
const updateProjectTokenStmt = db.prepare(`
  UPDATE projects SET github_token = ?, updated_at = datetime('now') WHERE id = ? AND status = 'active'
`);
const softDeleteProjectStmt = db.prepare("UPDATE projects SET status = 'deleted', updated_at = datetime('now') WHERE id = ?");

export function createProject(name: string, purpose: string, githubToken: string, createdBy?: number | null): Project {
  const id = randomUUID();
  insertProject.run(id, name, purpose, githubToken, createdBy ?? null);
  return getProjectById(id)!;
}

export function getProjects(includeDeleted = false): Project[] {
  return (includeDeleted ? selectAllProjects.all() : selectActiveProjects.all()) as Project[];
}

export function getProjectById(id: string): Project | undefined {
  return findProjectById.get(id) as Project | undefined;
}

export function updateProject(id: string, name: string, purpose: string): Project | undefined {
  updateProjectStmt.run(name, purpose, id);
  return getProjectById(id);
}

export function updateProjectToken(id: string, githubToken: string): Project | undefined {
  updateProjectTokenStmt.run(githubToken, id);
  return getProjectById(id);
}

export function deleteProject(id: string): Project | undefined {
  softDeleteProjectStmt.run(id);
  return getProjectById(id);
}

// ─── Admin seed ──────────────────────────────────────────────────────────────

export function seedAdminUser(): void {
  const username = env.ADMIN_USERNAME;
  const password = env.ADMIN_PASSWORD;
  if (!username || !password) {
    logger.warn("ADMIN_USERNAME or ADMIN_PASSWORD not set — no admin user seeded");
    return;
  }
  const existing = getUserByUsername(username);
  if (existing) {
    // Ensure admin user always has admin role
    if (existing.role !== "admin") {
      updateUserRole(existing.id, "admin");
      logger.info("Admin user role updated to admin", { username });
    } else {
      logger.debug("Admin user already exists", { username });
    }
    return;
  }
  createUser(username, password, "admin");
  logger.info("Admin user created", { username });
}
