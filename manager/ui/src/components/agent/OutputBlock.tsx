import React, { useState, useCallback } from "react";
import { BADGE_LABELS, BADGE_ICONS, escapeHtml } from "../../utils";
import "./OutputBlock.css";

/* ---------- CodeBlock sub-component ---------- */

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-lang">{lang || "text"}</span>
        <button className="copy-btn" onClick={handleCopy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* ---------- Content renderer (handles markdown code blocks) ---------- */

function renderContent(content: string): React.ReactNode {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before the code block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      parts.push(<span key={key++}>{renderInlineCode(text)}</span>);
    }
    parts.push(
      <CodeBlock key={key++} lang={match[1]} code={match[2].replace(/\n$/, "")} />
    );
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex);
    parts.push(<span key={key++}>{renderInlineCode(text)}</span>);
  }

  return parts.length > 0 ? parts : content;
}

function renderInlineCode(text: string): React.ReactNode {
  const inlineRegex = /`([^`]+)`/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <code key={key++} className="inline-code">
        {match[1]}
      </code>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

/* ---------- OutputBlock ---------- */

type OutputBlockProps = {
  msgType: string;
  content: string;
  timestamp: string;
  label?: string;
};

const OutputBlock = React.memo(function OutputBlock({
  msgType,
  content,
  timestamp,
  label,
}: OutputBlockProps) {
  const badgeLabel = label || BADGE_LABELS[msgType] || msgType;
  const badgeIcon = BADGE_ICONS[msgType] || "";

  return (
    <div className="output-block" data-type={msgType}>
      <div className="block-header">
        <span className="badge">
          {badgeIcon} {badgeLabel}
        </span>
        <span className="block-time">{timestamp}</span>
      </div>
      <span className="content">{renderContent(content)}</span>
    </div>
  );
});

export default OutputBlock;

/* ---------- ResultBlock ---------- */

export const ResultBlock = React.memo(function ResultBlock({
  msgType,
  content,
  timestamp,
}: {
  msgType: string;
  content: string;
  timestamp: string;
}) {
  const badgeLabel = BADGE_LABELS[msgType] || msgType;
  const badgeIcon = BADGE_ICONS[msgType] || "";

  return (
    <div className="output-block result-block" data-type={msgType}>
      <div className="block-header">
        <span className="badge">
          {badgeIcon} {badgeLabel}
        </span>
        <span className="block-time">{timestamp}</span>
      </div>
      <span className="content">{renderContent(content)}</span>
    </div>
  );
});

/* ---------- ThinkingBlock (collapsible) ---------- */

export const ThinkingBlock = React.memo(function ThinkingBlock({
  msgType,
  content,
  timestamp,
}: {
  msgType: string;
  content: string;
  timestamp: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const badgeLabel = BADGE_LABELS[msgType] || msgType;
  const badgeIcon = BADGE_ICONS[msgType] || "";

  return (
    <div
      className={`output-block thinking-block${expanded ? " expanded" : ""}`}
      data-type={msgType}
    >
      <div
        className="block-header clickable"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="thinking-chevron">{"\u25B6"}</span>
        <span className="badge">
          {badgeIcon} {badgeLabel}
        </span>
        <span className="block-time">{timestamp}</span>
      </div>
      <div className="thinking-content">{renderContent(content)}</div>
    </div>
  );
});

/* ---------- SystemBlock (collapsible, extracts model name) ---------- */

export const SystemBlock = React.memo(function SystemBlock({
  content,
  timestamp,
}: {
  content: string;
  timestamp: string;
}) {
  const [expanded, setExpanded] = useState(false);

  // Attempt to extract model name from system content
  const modelMatch = content.match(/model[:\s]+([^\s,\n]+)/i);
  const summary = modelMatch ? modelMatch[1] : content.slice(0, 80);

  return (
    <div
      className={`output-block system-block${expanded ? " expanded" : ""}`}
      data-type="system"
    >
      <div
        className="block-header clickable"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="system-chevron">{"\u25B6"}</span>
        <span className="badge">
          {BADGE_ICONS["system"]} {BADGE_LABELS["system"]}
        </span>
        <span className="system-summary">{summary}</span>
        <span className="block-time">{timestamp}</span>
      </div>
      <div className="system-content">{renderContent(content)}</div>
    </div>
  );
});

/* ---------- ToolProgressBlock ---------- */

export const ToolProgressBlock = React.memo(function ToolProgressBlock({
  content,
  timestamp,
}: {
  content: string;
  timestamp: string;
}) {
  return (
    <div className="output-block" data-type="tool_progress">
      <div className="block-header">
        <span className="badge">
          {BADGE_ICONS["tool_progress"]} {BADGE_LABELS["tool_progress"]}
        </span>
        <span className="block-time">{timestamp}</span>
      </div>
      <span className="content">{content}</span>
    </div>
  );
});
