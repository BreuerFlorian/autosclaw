export function fmtNum(n: number): string {
  return n.toLocaleString();
}

export function fmtCompact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

export function fmtCost(n: number): string {
  if (n >= 100) return "$" + n.toFixed(0);
  if (n >= 10) return "$" + n.toFixed(1);
  return "$" + n.toFixed(2);
}

export function formatDate(isoStr: string | null): string {
  if (!isoStr) return "";
  try {
    return new Date(isoStr).toLocaleString(undefined, { timeZoneName: "short" });
  } catch {
    return isoStr;
  }
}

export function escapeHtml(str: string): string {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

export function isMobile(): boolean {
  return window.matchMedia("(max-width: 767.98px)").matches;
}

export const BADGE_LABELS: Record<string, string> = {
  text: "text", thinking: "thinking", redacted_thinking: "redacted",
  tool_use: "tool use", server_tool_use: "server tool", mcp_tool_use: "mcp tool",
  mcp_tool_result: "mcp result", web_search_tool_result: "web search",
  web_fetch_tool_result: "web fetch", bash_code_execution_tool_result: "bash output",
  text_editor_code_execution_tool_result: "text editor",
  code_execution_tool_result: "code exec", tool_search_tool_result: "tool search",
  container_upload: "upload", compaction: "compaction",
  result_success: "result", result_error: "error", tool_progress: "progress",
  system: "system", auth_status: "auth", user_input: "you",
};

export const BADGE_ICONS: Record<string, string> = {
  text: "\u{1F4AC}", thinking: "\u{1F4AD}", redacted_thinking: "\u{1F512}",
  tool_use: "\u{1F527}", server_tool_use: "\u{2699}\uFE0F", mcp_tool_use: "\u{1F50C}",
  mcp_tool_result: "\u{1F4E5}", web_search_tool_result: "\u{1F50D}",
  web_fetch_tool_result: "\u{1F310}", bash_code_execution_tool_result: "\u{1F4BB}",
  text_editor_code_execution_tool_result: "\u{270F}\uFE0F",
  code_execution_tool_result: "\u{25B6}\uFE0F", tool_search_tool_result: "\u{1F50E}",
  container_upload: "\u{1F4E4}", compaction: "\u{1F5DC}\uFE0F",
  result_success: "\u2705", result_error: "\u274C", tool_progress: "\u23F3",
  system: "\u2699\uFE0F", auth_status: "\u{1F511}", user_input: "\u{1F464}",
};

export const TOOL_ICONS: Record<string, string> = {
  Bash: "\u{1F4BB}", Read: "\u{1F4C4}", Write: "\u{270F}\uFE0F", Edit: "\u{1F4DD}",
  Glob: "\u{1F4C2}", Grep: "\u{1F50D}", Agent: "\u{1F916}", WebFetch: "\u{1F310}",
  WebSearch: "\u{1F50E}", TodoWrite: "\u{2705}", NotebookEdit: "\u{1F4D3}",
  AskUserQuestion: "\u2753", Skill: "\u{1F3AF}", TaskOutput: "\u{1F4CB}",
  TaskStop: "\u{1F6D1}",
};

export const TOOL_TYPE_LABELS: Record<string, string> = {
  tool_use: "tool", server_tool_use: "server tool", mcp_tool_use: "mcp tool",
};

export function formatToolSummary(name: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const inp = input as Record<string, unknown>;
  const baseName = name.includes("/") ? name.split("/").pop()! : name;

  switch (baseName) {
    case "Bash":
      return inp.command ? String(inp.command) : null;
    case "Read":
    case "Write":
    case "Edit":
      return inp.file_path ? String(inp.file_path) : null;
    case "Glob":
      return inp.pattern ? String(inp.pattern) + (inp.path ? " in " + inp.path : "") : null;
    case "Grep":
      return inp.pattern ? '"' + inp.pattern + '"' + (inp.path ? " in " + inp.path : "") : null;
    case "WebFetch":
      return inp.url ? String(inp.url) : null;
    case "WebSearch":
      return inp.query ? '"' + inp.query + '"' : null;
    case "Agent":
      return inp.description ? String(inp.description) : null;
    case "TodoWrite": {
      const todos = inp.todos;
      if (!Array.isArray(todos)) return null;
      const done = todos.filter((t: Record<string, unknown>) => t.status === "completed").length;
      const total = todos.length;
      const active = todos.find((t: Record<string, unknown>) => t.status === "in_progress") as Record<string, unknown> | undefined;
      return done + "/" + total + " done" + (active ? " \u2014 " + active.activeForm : "");
    }
    default:
      return null;
  }
}
