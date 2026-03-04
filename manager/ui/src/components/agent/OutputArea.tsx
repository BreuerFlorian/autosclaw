import React from "react";
import { useApp } from "../../context/AppContext";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import OutputBlock, {
  ResultBlock,
  ThinkingBlock,
  SystemBlock,
  ToolProgressBlock,
} from "./OutputBlock";
import ToolCard from "./ToolCard";
import { AskUserCard } from "./AskUserCard";
import "./OutputArea.css";

export function OutputArea() {
  const { state } = useApp();
  const { containerRef } = useAutoScroll([state.outputs.length]);

  return (
    <div className="output-area" ref={containerRef}>
      {state.outputs.map((entry, i) => {
        switch (entry.kind) {
          case "output":
            return renderOutputEntry(entry, i);

          case "text_entry":
            return (
              <OutputBlock
                key={i}
                msgType={entry.role === "user" ? "user_input" : "text"}
                content={entry.text}
                timestamp={entry.timestamp}
                label={entry.role === "user" ? "you" : undefined}
              />
            );

          case "tool_use":
            return (
              <ToolCard
                key={i}
                toolType={entry.toolType}
                name={entry.name}
                input={entry.input}
                timestamp={entry.timestamp}
              />
            );

          case "ask_user":
            return (
              <AskUserCard
                key={i}
                questions={entry.questions}
                answered={entry.answered}
                index={i}
              />
            );

          default:
            return null;
        }
      })}
    </div>
  );
}

function renderOutputEntry(
  entry: { kind: "output"; msgType: string; content: string; timestamp: string },
  index: number
): React.ReactNode {
  const { msgType, content, timestamp } = entry;

  switch (msgType) {
    case "result_success":
    case "result_error":
      return (
        <ResultBlock
          key={index}
          msgType={msgType}
          content={content}
          timestamp={timestamp}
        />
      );

    case "thinking":
    case "redacted_thinking":
      return (
        <ThinkingBlock
          key={index}
          msgType={msgType}
          content={content}
          timestamp={timestamp}
        />
      );

    case "system":
      return (
        <SystemBlock key={index} content={content} timestamp={timestamp} />
      );

    case "tool_progress":
      return (
        <ToolProgressBlock
          key={index}
          content={content}
          timestamp={timestamp}
        />
      );

    default:
      return (
        <OutputBlock
          key={index}
          msgType={msgType}
          content={content}
          timestamp={timestamp}
        />
      );
  }
}
