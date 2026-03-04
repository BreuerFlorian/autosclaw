/**
 * SDK message and content block types for the Claude Agent SDK v2.
 *
 * These mirror the actual types from @anthropic-ai/claude-agent-sdk.
 * The SDK exports them directly — use these helpers for narrowing and display.
 */

// ─── Content block types (inside assistant messages) ─────────────────────────

/** All possible `block.type` values inside `msg.message.content`. */
export type ContentBlockType =
  | "text"
  | "thinking"
  | "redacted_thinking"
  | "tool_use"
  | "server_tool_use"
  | "mcp_tool_use"
  | "mcp_tool_result"
  | "web_search_tool_result"
  | "web_fetch_tool_result"
  | "code_execution_tool_result"
  | "bash_code_execution_tool_result"
  | "text_editor_code_execution_tool_result"
  | "tool_search_tool_result"
  | "container_upload"
  | "compaction";

// ─── SDK message types (yielded by session.stream()) ─────────────────────────

/** All possible `msg.type` values from the stream. */
export type SDKMessageType =
  | "assistant"
  | "user"
  | "result"
  | "system"
  | "stream_event"
  | "tool_progress"
  | "auth_status";

/** Result subtypes — "success" carries `result`, others carry `errors`. */
export type ResultSubtype =
  | "success"
  | "error_during_execution"
  | "error_max_turns"
  | "error_max_budget_usd"
  | "error_max_structured_output_retries";

/** System message subtypes. */
export type SystemSubtype = "init" | "compact_boundary" | "status" | "hook_response";

// ─── Display helpers ─────────────────────────────────────────────────────────

/** Format a content block for terminal display. */
export function formatContentBlock(block: { type: string; [key: string]: unknown }): string | null {
  switch (block.type) {
    case "text":
      return block.text as string;

    case "thinking":
      return `[thinking] ${block.thinking as string}`;

    case "redacted_thinking":
      return "[redacted thinking]";

    case "tool_use":
      return `[tool_use] ${block.name as string}(${JSON.stringify(block.input)})`;

    case "server_tool_use":
      return `[server_tool] ${block.name as string}(${JSON.stringify(block.input)})`;

    case "mcp_tool_use":
      return `[mcp_tool] ${block.server_name as string}/${block.name as string}(${JSON.stringify(block.input)})`;

    case "mcp_tool_result":
      return `[mcp_result] ${block.is_error ? "ERROR: " : ""}${typeof block.content === "string" ? block.content : JSON.stringify(block.content)}`;

    case "web_search_tool_result":
      return `[web_search_result] ${JSON.stringify(block.content)}`;

    case "web_fetch_tool_result":
      return `[web_fetch_result] ${JSON.stringify(block.content)}`;

    case "bash_code_execution_tool_result": {
      const result = block.content as { type: string; stdout?: string; stderr?: string; return_code?: number };
      if (result.type === "bash_code_execution_result") {
        return result.return_code === 0
          ? `[bash_output] ${result.stdout ?? ""}`
          : `[bash_error] ${result.stderr ?? ""}`;
      }
      return `[bash_error] ${JSON.stringify(result)}`;
    }

    case "text_editor_code_execution_tool_result":
      return `[text_editor_result] ${JSON.stringify(block.content)}`;

    case "code_execution_tool_result":
      return `[code_execution_result] ${JSON.stringify(block.content)}`;

    case "tool_search_tool_result":
      return `[tool_search_result] ${JSON.stringify(block.content)}`;

    case "container_upload":
      return `[container_upload] file_id=${block.file_id as string}`;

    case "compaction":
      return `[compaction] ${(block.content as string | null) ?? "(compacted)"}`;

    default:
      return `[${block.type}] ${JSON.stringify(block)}`;
  }
}

/** Format an SDK message for terminal display. Returns null for messages with no visible output. */
export function formatMessage(msg: { type: string; [key: string]: unknown }): string | null {
  switch (msg.type) {
    case "assistant": {
      const content = (msg.message as { content: Array<{ type: string; [key: string]: unknown }> }).content;
      const parts = content.map(formatContentBlock).filter(Boolean);
      return parts.length > 0 ? parts.join("\n") : null;
    }

    case "result": {
      if (msg.subtype === "success") {
        return `[result] ${msg.result as string}`;
      }
      return `[error:${msg.subtype as string}] ${(msg.errors as string[]).join("; ")}`;
    }

    case "system":
      switch (msg.subtype) {
        case "init":
          return `[init] model=${msg.model as string} tools=[${(msg.tools as string[]).join(", ")}]`;
        case "compact_boundary":
          return "[compact_boundary]";
        case "status":
          return `[status] ${(msg.status as string | null) ?? "idle"}`;
        case "hook_response":
          return `[hook] ${msg.hook_name as string}/${msg.hook_event as string}`;
        default:
          return null;
      }

    case "tool_progress":
      return `[progress] ${msg.tool_name as string} (${msg.elapsed_time_seconds as number}s)`;

    case "auth_status":
      return `[auth] ${(msg.isAuthenticating as boolean) ? "authenticating…" : "authenticated"}`;

    case "user":
      return null; // user messages are echoes — skip

    case "stream_event":
      return null; // partial streaming events — skip in non-streaming mode

    default:
      return `[${msg.type}] ${JSON.stringify(msg)}`;
  }
}
