import React, { useState } from "react";
import { TOOL_TYPE_LABELS, TOOL_ICONS, formatToolSummary } from "../../utils";
import "./ToolCard.css";

type ToolCardProps = {
  toolType: string;
  name: string;
  input: unknown;
  timestamp: string;
};

const ToolCard = React.memo(function ToolCard({
  toolType,
  name,
  input,
  timestamp,
}: ToolCardProps) {
  const baseName = name.includes("/") ? name.split("/").pop()! : name;
  const isTodoWrite = baseName === "TodoWrite";
  const [open, setOpen] = useState(isTodoWrite);

  const typeLabel = TOOL_TYPE_LABELS[toolType] || "tool";
  const icon = TOOL_ICONS[baseName] || "\u{1F527}";
  const summary = formatToolSummary(name, input);
  const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  return (
    <div className={`tool-card${open ? " open" : ""}`}>
      <div className="tool-header" onClick={() => setOpen((o) => !o)}>
        <span className="tool-badge">
          {icon} {typeLabel}
        </span>
        <span className="tool-name">{baseName}</span>
        {summary && <span className="tool-summary">{summary}</span>}
        <span className="block-time">{timestamp}</span>
        <span className="tool-chevron">{"\u25B6"}</span>
      </div>
      <div className="tool-detail">{renderDetail(baseName, inp)}</div>
    </div>
  );
});

export default ToolCard;

/* ---------- Detail renderers ---------- */

function renderDetail(
  name: string,
  inp: Record<string, unknown>
): React.ReactNode {
  switch (name) {
    case "Bash":
      return renderBash(inp);
    case "Edit":
      return renderEdit(inp);
    case "TodoWrite":
      return renderTodoWrite(inp);
    case "Write":
      return renderWrite(inp);
    case "Read":
    case "Glob":
    case "Grep":
      return renderFilePath(inp);
    default:
      return renderJson(inp);
  }
}

function renderBash(inp: Record<string, unknown>) {
  const command = inp.command ? String(inp.command) : "";
  const description = inp.description ? String(inp.description) : "";

  return (
    <div className="tool-cmd-block">
      <pre>{command}</pre>
      {description && <div className="tool-cmd-desc">{description}</div>}
    </div>
  );
}

function renderEdit(inp: Record<string, unknown>) {
  const filePath = inp.file_path ? String(inp.file_path) : "";
  const oldStr = inp.old_string != null ? String(inp.old_string) : "";
  const newStr = inp.new_string != null ? String(inp.new_string) : "";

  return (
    <>
      {filePath && <div className="tool-file-path">{filePath}</div>}
      <div className="tool-diff">
        {oldStr && (
          <>
            <div className="diff-label diff-remove">- Remove</div>
            <pre className="diff-content diff-old">{oldStr}</pre>
          </>
        )}
        {newStr && (
          <>
            <div className="diff-label diff-add">+ Add</div>
            <pre className="diff-content diff-new">{newStr}</pre>
          </>
        )}
      </div>
    </>
  );
}

function renderTodoWrite(inp: Record<string, unknown>) {
  const todos = inp.todos;
  if (!Array.isArray(todos)) return renderJson(inp);

  return (
    <div className="todo-list">
      {todos.map((todo: Record<string, unknown>, i: number) => {
        const status = String(todo.status || "pending");
        const content = String(todo.content || todo.activeForm || "");
        const icon =
          status === "completed"
            ? "\u2705"
            : status === "in_progress"
              ? "\u{1F504}"
              : "\u25CB";

        return (
          <div key={i} className={`todo-item todo-${status}`}>
            <span className="todo-check">{icon}</span>
            <span className="todo-text">{content}</span>
          </div>
        );
      })}
    </div>
  );
}

function renderWrite(inp: Record<string, unknown>) {
  const filePath = inp.file_path ? String(inp.file_path) : "";
  const content = inp.content ? String(inp.content) : "";
  const preview = content.length > 2000 ? content.slice(0, 2000) + "\n..." : content;

  return (
    <>
      {filePath && <div className="tool-file-path">{filePath}</div>}
      {content && <pre className="tool-file-content">{preview}</pre>}
    </>
  );
}

function renderFilePath(inp: Record<string, unknown>) {
  const filePath =
    inp.file_path || inp.path || inp.pattern
      ? String(inp.file_path || inp.path || inp.pattern)
      : "";

  if (inp.pattern && inp.path) {
    return (
      <div className="tool-file-path">
        {String(inp.pattern)} in {String(inp.path)}
      </div>
    );
  }

  return filePath ? <div className="tool-file-path">{filePath}</div> : null;
}

function renderJson(inp: Record<string, unknown>) {
  let json: string;
  try {
    json = JSON.stringify(inp, null, 2);
  } catch {
    json = String(inp);
  }
  return <pre>{json}</pre>;
}
