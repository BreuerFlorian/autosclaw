import {
  query,
  createSdkMcpServer,
  tool,
  type SDKMessage,
  type SDKResultMessage,
  type SDKAssistantMessage,
  type SDKSystemMessage,
  type SDKStatusMessage,
  type SDKToolProgressMessage,
  type SDKAuthStatusMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ManagerClient } from "./manager-client.js";
import { formatContentBlock } from "./types.js";

// ── Read secrets from stdin ──────────────────────────────────────────────
// Secrets are piped via stdin (e.g. `cat .env | node ...`) so they never
// exist on disk or in the parent's process.env. Stdin is consumed and closed
// before the model runs — no file, no env var, no /proc to leak.

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}

const stdinData = await readStdin();
const envSecrets: Record<string, string> = {};
for (const line of stdinData.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let val = trimmed.slice(eq + 1).trim();
  // Strip matching outer quotes, then unescape inner escaped quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    const quote = val[0];
    val = val.slice(1, -1).replace(new RegExp(`\\\\${quote}`, "g"), quote);
  }
  envSecrets[key] = val;
}

if (!envSecrets.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error("Fatal: CLAUDE_CODE_OAUTH_TOKEN not found in stdin");
  console.error("  Usage: cat .env | node --import tsx src/main.ts");
  process.exit(1);
}

const managerUrl = envSecrets.MANAGER_URL;
const agentId = envSecrets.AGENT_ID;
const agentToken = envSecrets.AGENT_TOKEN;

if (!managerUrl || !agentId || !agentToken) {
  console.error("Fatal: MANAGER_URL, AGENT_ID, and AGENT_TOKEN must be provided in stdin");
  console.error("  These are set automatically by the task manager.");
  process.exit(1);
}

// Inject secrets into process.env so the SDK subprocess inherits them
for (const [k, v] of Object.entries(envSecrets)) {
  process.env[k] = v;
}

const dashboard = new ManagerClient(managerUrl, agentId, agentToken);

// Manager HTTP API base URL (derived from WebSocket URL)
const wsUrl = new URL(managerUrl);
wsUrl.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
wsUrl.pathname = "/";
const apiBase = wsUrl.origin;

// ── MCP server: agent management tools ───────────────────────────────────

const mcpServer = createSdkMcpServer({
  name: "autosclaw",
  version: "1.0.0",
  tools: [
    tool(
      "spawn_agent",
      "Spawn a new autonomous agent container. The new agent starts in its own isolated container with its own Claude Code session and appears in the manager dashboard.",
      {
        name: z.string().describe("Display name for the new agent"),
        purpose: z.string().describe("Brief description of what the agent does"),
        systemPrompt: z.string().describe("Initial instructions / system prompt for the new agent"),
      },
      async (args) => {
        try {
          const result = await dashboard.spawnAgent(args);
          return {
            content: [{ type: "text" as const, text: `Agent spawned successfully.\nAgent ID: ${result.agentId}\nName: ${result.name}` }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Failed to spawn agent: ${err}` }],
            isError: true,
          };
        }
      },
    ),

    tool(
      "list_agents",
      "List all running agent containers. Each entry shows the agent's ID, name, purpose, status, and whether it is this agent (isSelf).",
      {},
      async () => {
        try {
          const res = await fetch(`${apiBase}/api/agents?self=${encodeURIComponent(agentId)}`, {
            headers: { Authorization: `Bearer ${agentToken}` },
          });
          if (!res.ok) {
            return { content: [{ type: "text" as const, text: `Failed to list agents: ${res.status} ${res.statusText}` }], isError: true };
          }
          const data = (await res.json()) as { agents: { id: string; name: string; purpose: string; status: string; isSelf: boolean }[] };
          const lines = data.agents.map((a) =>
            `${a.isSelf ? "→ " : "  "}[${a.status}] ${a.name} (${a.id})${a.purpose ? ` — ${a.purpose}` : ""}`,
          );
          return {
            content: [{ type: "text" as const, text: lines.length > 0 ? lines.join("\n") : "No agents running." }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Failed to list agents: ${err}` }],
            isError: true,
          };
        }
      },
    ),

    tool(
      "despawn_agent",
      "Stop and remove an agent container by its ID. The agent will be terminated and removed from the manager dashboard. An agent cannot despawn itself. An agent that is already stopping cannot be stopped again.",
      {
        agentId: z.string().describe("The ID of the agent to despawn"),
      },
      async (args) => {
        if (args.agentId === agentId) {
          return {
            content: [{ type: "text" as const, text: "Cannot despawn yourself." }],
            isError: true,
          };
        }

        // Check if agent is already stopping
        try {
          const listRes = await fetch(`${apiBase}/api/agents?self=${encodeURIComponent(agentId)}`, {
            headers: { Authorization: `Bearer ${agentToken}` },
          });
          const listData = (await listRes.json()) as { agents: { id: string; status: string }[] };
          const targetAgent = listData.agents.find((a) => a.id === args.agentId);
          if (!targetAgent) {
            return {
              content: [{ type: "text" as const, text: "Agent not found." }],
              isError: true,
            };
          }
          if (targetAgent.status === "stopping") {
            return {
              content: [{ type: "text" as const, text: "Agent is already stopping." }],
              isError: true,
            };
          }
        } catch {
          // If we can't check, proceed with despawn anyway
        }

        try {
          const res = await fetch(`${apiBase}/api/despawn`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${agentToken}`,
            },
            body: JSON.stringify({ agentId: args.agentId }),
          });
          const data = (await res.json()) as { agentId?: string; name?: string; error?: string };
          if (!res.ok) {
            return {
              content: [{ type: "text" as const, text: `Failed: ${data.error ?? res.statusText}` }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text" as const, text: `Agent despawned.\nAgent ID: ${data.agentId}\nName: ${data.name}` }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Failed to despawn agent: ${err}` }],
            isError: true,
          };
        }
      },
    ),

    // ── Schedule management tools ──────────────────────────────────────────

    tool(
      "list_schedules",
      "List all schedules. Returns each schedule's ID, name, cron expression, status, and next run time.",
      {
        include_deleted: z.boolean().optional().describe("Include soft-deleted schedules (default false)"),
      },
      async (args) => {
        try {
          const url = `${apiBase}/api/schedules${args.include_deleted ? "?include_deleted=true" : ""}`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${agentToken}` } });
          if (!res.ok) {
            return { content: [{ type: "text" as const, text: `Failed to list schedules: ${res.status} ${res.statusText}` }], isError: true };
          }
          const data = (await res.json()) as { schedules: Array<{ id: string; name: string; cron_expression: string; status: string; next_run_at: string | null }> };
          if (!data.schedules || data.schedules.length === 0) {
            return { content: [{ type: "text" as const, text: "No schedules found." }] };
          }
          const lines = data.schedules.map((s) =>
            `[${s.status}] ${s.name} (${s.id})\n  cron: ${s.cron_expression}  next: ${s.next_run_at ?? "—"}`,
          );
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Failed to list schedules: ${err}` }], isError: true };
        }
      },
    ),

    tool(
      "create_schedule",
      "Create a new schedule that will spawn an agent on a cron schedule. Returns the created schedule.",
      {
        name: z.string().describe("Human-readable name for the schedule"),
        cron_expression: z.string().describe("Cron expression in UTC (5-field: minute hour day-of-month month day-of-week)"),
        schedule_type: z.enum(["recurring", "once"]).optional().describe("Schedule type: 'recurring' (default) runs on every cron match, 'once' runs a single time then auto-deletes"),
        agent_name: z.string().optional().describe("Name for the spawned agent"),
        agent_purpose: z.string().optional().describe("Purpose description for the spawned agent"),
        agent_system_prompt: z.string().optional().describe("System prompt for the spawned agent"),
      },
      async (args) => {
        try {
          const res = await fetch(`${apiBase}/api/schedules`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({
              name: args.name,
              cron_expression: args.cron_expression,
              schedule_type: args.schedule_type ?? "recurring",
              agent_name: args.agent_name ?? "",
              agent_purpose: args.agent_purpose ?? "",
              agent_system_prompt: args.agent_system_prompt ?? "",
            }),
          });
          const data = (await res.json()) as { schedule?: { id: string; name: string; cron_expression: string; next_run_at: string | null }; error?: string };
          if (!res.ok) {
            return { content: [{ type: "text" as const, text: `Failed: ${data.error ?? res.statusText}` }], isError: true };
          }
          const s = data.schedule!;
          return {
            content: [{ type: "text" as const, text: `Schedule created.\nID: ${s.id}\nName: ${s.name}\nCron: ${s.cron_expression}\nNext run: ${s.next_run_at ?? "—"}` }],
          };
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Failed to create schedule: ${err}` }], isError: true };
        }
      },
    ),

    tool(
      "get_schedule",
      "Get details of a single schedule by its ID.",
      {
        scheduleId: z.string().describe("The UUID of the schedule"),
      },
      async (args) => {
        try {
          const res = await fetch(`${apiBase}/api/schedules/${encodeURIComponent(args.scheduleId)}`, {
            headers: { Authorization: `Bearer ${agentToken}` },
          });
          const data = (await res.json()) as { schedule?: { id: string; name: string; cron_expression: string; status: string; agent_name: string; agent_purpose: string; agent_system_prompt: string; next_run_at: string | null; last_run_at: string | null }; error?: string };
          if (!res.ok) {
            return { content: [{ type: "text" as const, text: `Failed: ${data.error ?? res.statusText}` }], isError: true };
          }
          const s = data.schedule!;
          const lines = [
            `Name: ${s.name}`,
            `ID: ${s.id}`,
            `Status: ${s.status}`,
            `Cron: ${s.cron_expression}`,
            `Agent name: ${s.agent_name || "—"}`,
            `Agent purpose: ${s.agent_purpose || "—"}`,
            `System prompt: ${s.agent_system_prompt || "—"}`,
            `Next run: ${s.next_run_at ?? "—"}`,
            `Last run: ${s.last_run_at ?? "—"}`,
          ];
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Failed to get schedule: ${err}` }], isError: true };
        }
      },
    ),

    tool(
      "update_schedule",
      "Update an existing schedule. Only provided fields are changed.",
      {
        scheduleId: z.string().describe("The UUID of the schedule to update"),
        name: z.string().optional().describe("New name"),
        cron_expression: z.string().optional().describe("New cron expression"),
        schedule_type: z.enum(["recurring", "once"]).optional().describe("Schedule type: 'recurring' or 'once'"),
        agent_name: z.string().optional().describe("New agent name"),
        agent_purpose: z.string().optional().describe("New agent purpose"),
        agent_system_prompt: z.string().optional().describe("New system prompt"),
      },
      async (args) => {
        try {
          const body: Record<string, string> = {};
          if (args.name !== undefined) body.name = args.name;
          if (args.cron_expression !== undefined) body.cron_expression = args.cron_expression;
          if (args.schedule_type !== undefined) body.schedule_type = args.schedule_type;
          if (args.agent_name !== undefined) body.agent_name = args.agent_name;
          if (args.agent_purpose !== undefined) body.agent_purpose = args.agent_purpose;
          if (args.agent_system_prompt !== undefined) body.agent_system_prompt = args.agent_system_prompt;
          const res = await fetch(`${apiBase}/api/schedules/${encodeURIComponent(args.scheduleId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify(body),
          });
          const data = (await res.json()) as { schedule?: { id: string; name: string; cron_expression: string }; error?: string };
          if (!res.ok) {
            return { content: [{ type: "text" as const, text: `Failed: ${data.error ?? res.statusText}` }], isError: true };
          }
          const s = data.schedule!;
          return {
            content: [{ type: "text" as const, text: `Schedule updated.\nID: ${s.id}\nName: ${s.name}\nCron: ${s.cron_expression}` }],
          };
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Failed to update schedule: ${err}` }], isError: true };
        }
      },
    ),

    tool(
      "pause_schedule",
      "Pause an active schedule. A paused schedule will not trigger until resumed.",
      {
        scheduleId: z.string().describe("The UUID of the schedule to pause"),
      },
      async (args) => {
        try {
          const res = await fetch(`${apiBase}/api/schedules/${encodeURIComponent(args.scheduleId)}/pause`, {
            method: "POST",
            headers: { Authorization: `Bearer ${agentToken}` },
          });
          const data = (await res.json()) as { schedule?: { id: string; name: string }; error?: string };
          if (!res.ok) {
            return { content: [{ type: "text" as const, text: `Failed: ${data.error ?? res.statusText}` }], isError: true };
          }
          return { content: [{ type: "text" as const, text: `Schedule "${data.schedule!.name}" paused.` }] };
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Failed to pause schedule: ${err}` }], isError: true };
        }
      },
    ),

    tool(
      "resume_schedule",
      "Resume a paused schedule.",
      {
        scheduleId: z.string().describe("The UUID of the schedule to resume"),
      },
      async (args) => {
        try {
          const res = await fetch(`${apiBase}/api/schedules/${encodeURIComponent(args.scheduleId)}/resume`, {
            method: "POST",
            headers: { Authorization: `Bearer ${agentToken}` },
          });
          const data = (await res.json()) as { schedule?: { id: string; name: string }; error?: string };
          if (!res.ok) {
            return { content: [{ type: "text" as const, text: `Failed: ${data.error ?? res.statusText}` }], isError: true };
          }
          return { content: [{ type: "text" as const, text: `Schedule "${data.schedule!.name}" resumed.` }] };
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Failed to resume schedule: ${err}` }], isError: true };
        }
      },
    ),

    tool(
      "delete_schedule",
      "Soft-delete a schedule. The schedule will no longer trigger and will be hidden from listings by default.",
      {
        scheduleId: z.string().describe("The UUID of the schedule to delete"),
      },
      async (args) => {
        try {
          const res = await fetch(`${apiBase}/api/schedules/${encodeURIComponent(args.scheduleId)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${agentToken}` },
          });
          const data = (await res.json()) as { schedule?: { id: string; name: string }; error?: string };
          if (!res.ok) {
            return { content: [{ type: "text" as const, text: `Failed: ${data.error ?? res.statusText}` }], isError: true };
          }
          return { content: [{ type: "text" as const, text: `Schedule "${data.schedule!.name}" deleted.` }] };
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Failed to delete schedule: ${err}` }], isError: true };
        }
      },
    ),
  ],
});

// ── Async message channel for v1 streaming input ─────────────────────────
// The v1 query() API with AsyncIterable<SDKUserMessage> keeps a single
// Claude Code process alive. Each yielded message triggers a new turn.

class AsyncChannel implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private resolve: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;

  push(message: string, sessionId: string): void {
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: `===== THIS IS THE USER PROMPT =====\n${message}` },
      parent_tool_use_id: null,
      session_id: sessionId,
    };
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: msg, done: false });
    } else {
      this.queue.push(msg);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        return new Promise((r) => { this.resolve = r; });
      },
    };
  }
}

const input = new AsyncChannel();
let sessionId = "";

// Start multi-turn conversation with in-process MCP server
const conversation = query({
  prompt: input,
  options: {
    model: "claude-opus-4-6",
    systemPrompt: { type: "preset", preset: "claude_code" },
    mcpServers: { autosclaw: mcpServer },
    allowedTools: [
      // Built-in tools — auto-approve so the agent never blocks on permission prompts
      "Bash", "Read", "Write", "Edit", "Glob", "Grep",
      "Agent", "TodoWrite", "WebFetch", "WebSearch",
      "NotebookEdit", "TaskOutput", "TaskStop",
      "Skill",
      "EnterPlanMode", "ExitPlanMode", "EnterWorktree",
      // MCP tools
      "mcp__autosclaw__spawn_agent", "mcp__autosclaw__list_agents", "mcp__autosclaw__despawn_agent",
      "mcp__autosclaw__list_schedules", "mcp__autosclaw__create_schedule", "mcp__autosclaw__get_schedule",
      "mcp__autosclaw__update_schedule", "mcp__autosclaw__pause_schedule", "mcp__autosclaw__resume_schedule",
      "mcp__autosclaw__delete_schedule",
    ],
    // AskUserQuestion is NOT in allowedTools — it triggers canUseTool so we can
    // forward the questions to the dashboard and wait for the human to respond.
    canUseTool: async (toolName: string, input: Record<string, unknown>) => {
      if (toolName === "AskUserQuestion") {
        const questions = (input.questions ?? []) as unknown[];
        const answers = await dashboard.waitForAskUser(questions);
        return {
          behavior: "allow" as const,
          updatedInput: { questions: input.questions, answers },
        };
      }
      // Auto-approve everything else
      return { behavior: "allow" as const, updatedInput: input };
    },
  },
});

// Scrub secrets from process.env now that the subprocess has started
const SECRET_VARS = ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "CLAUDE_CODE_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "AGENT_TOKEN"];
for (const k of SECRET_VARS) delete process.env[k];

// ── Route SDK messages to dashboard ──────────────────────────────────────

function routeMessage(msg: SDKMessage): void {
  switch (msg.type) {
    case "assistant": {
      const assistantMsg = msg as SDKAssistantMessage;
      for (const block of assistantMsg.message.content) {
        const b = block as { type: string; name?: string; input?: unknown; server_name?: string; [key: string]: unknown };

        // Route tool_use blocks as structured data
        if (b.type === "tool_use" || b.type === "server_tool_use" || b.type === "mcp_tool_use") {
          const toolName = b.type === "mcp_tool_use"
            ? `${b.server_name ?? "mcp"}/${b.name ?? "unknown"}`
            : (b.name ?? "unknown");

          dashboard.appendToolUse(b.type, toolName, b.input ?? {});
          continue;
        }

        const text = formatContentBlock(b);
        if (text) {
          dashboard.appendOutput(block.type, text);
        }
      }
      break;
    }

    case "result": {
      const resultMsg = msg as SDKResultMessage;
      if (resultMsg.subtype === "success") {
        dashboard.appendOutput("result_success", resultMsg.result);
      } else {
        dashboard.appendOutput("result_error", `[${resultMsg.subtype}] ${resultMsg.errors.join("; ")}`);
      }

      // Aggregate token usage across all models in this turn
      const modelUsage = resultMsg.modelUsage;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheRead = 0;
      let cacheWrite = 0;
      for (const mu of Object.values(modelUsage)) {
        inputTokens += mu.inputTokens;
        outputTokens += mu.outputTokens;
        cacheRead += mu.cacheReadInputTokens;
        cacheWrite += mu.cacheCreationInputTokens;
      }
      dashboard.updateTokens({
        inputTokens,
        outputTokens,
        cacheReadInputTokens: cacheRead,
        cacheCreationInputTokens: cacheWrite,
        costUSD: resultMsg.total_cost_usd,
      });

      dashboard.setStatus("Connected — ready");
      break;
    }

    case "system": {
      if (msg.subtype === "init") {
        const initMsg = msg as SDKSystemMessage;
        const mcpStatus = initMsg.mcp_servers.map((s) => `${s.name}:${s.status}`).join(", ");
        dashboard.appendOutput("system", `model=${initMsg.model}  tools=[${initMsg.tools.join(", ")}]  mcp=[${mcpStatus}]`);
      } else if (msg.subtype === "status") {
        const statusMsg = msg as SDKStatusMessage;
        if (statusMsg.status) {
          dashboard.appendOutput("system", statusMsg.status);
        }
      }
      break;
    }

    case "tool_progress": {
      const progressMsg = msg as SDKToolProgressMessage;
      dashboard.appendOutput(
        "tool_progress",
        `${progressMsg.tool_name} (${progressMsg.elapsed_time_seconds}s)`,
      );
      break;
    }

    case "auth_status": {
      const authMsg = msg as SDKAuthStatusMessage;
      dashboard.appendOutput("auth_status", authMsg.isAuthenticating ? "Authenticating…" : "Authenticated");
      break;
    }

    // stream_event and user echoes are skipped
    default:
      break;
  }
}

// ── Wire up dashboard input → conversation ───────────────────────────────

dashboard.onSubmit((message: string) => {
  dashboard.setStatus("Agent is thinking…");
  input.push(message, sessionId);
});

for await (const msg of conversation) {
  if (msg.type === "system" && msg.subtype === "init") {
    sessionId = (msg as SDKSystemMessage).session_id;
  }
  routeMessage(msg);
}

// Keep process alive in case the conversation generator ends
await new Promise(() => {});
