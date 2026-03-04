import React, { useState, useRef, useCallback } from "react";
import { useApp } from "../../context/AppContext";
import "./ChatBar.css";

export function ChatBar() {
  const { state, sendChat, dispatch, userRole, userId } = useApp();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const agent = state.agents.find((a) => a.id === state.currentAgentId);

  // Hide chat bar for deleted agents (read-only history), viewers, or members who don't own the agent
  const canChat = agent && agent.status !== "deleted" && agent.status !== "stopped" &&
    userRole !== "viewer" &&
    (userRole === "admin" || agent.createdBy === userId);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      autoResize();
    },
    [autoResize]
  );

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    dispatch({ type: "REMOVE_UNANSWERED_ASKS" });
    sendChat(trimmed);
    setText("");

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, sendChat, dispatch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!canChat) return null;

  return (
    <div className="chat-bar">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Send a message..."
        rows={1}
      />
      <button onClick={handleSend} disabled={!text.trim()}>
        Send
      </button>
    </div>
  );
}
