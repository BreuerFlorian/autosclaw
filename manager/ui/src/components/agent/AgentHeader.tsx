import React from "react";
import { useApp } from "../../context/AppContext";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useSwipeBack } from "../../hooks/useSwipeBack";
import "./AgentHeader.css";

export function AgentHeader() {
  const { state, deselectAgent, stopAgent, userRole, userId } = useApp();
  const { confirm, ConfirmDialogElement } = useConfirmDialog();
  const agent = state.agents.find((a) => a.id === state.currentAgentId);
  useSwipeBack(deselectAgent);

  if (!agent) return null;

  const isHistory = agent.status === "deleted" || agent.status === "stopped";

  const statusLabel = isHistory
    ? "Chat History"
    : agent.waitingForAskUser
      ? "Waiting for input..."
      : agent.processing
        ? "Thinking..."
        : agent.status === "stopping"
          ? "Stopping..."
          : agent.status.charAt(0).toUpperCase() + agent.status.slice(1);

  const dotClass = isHistory ? "deleted" : agent.waitingForAskUser ? "waiting" : agent.status;

  const canStop = (agent.status === "running" || agent.status === "starting") &&
    userRole !== "viewer" &&
    (userRole === "admin" || agent.createdBy === userId);

  const handleStop = async () => {
    const ok = await confirm({
      title: "Stop Agent",
      message: `Are you sure you want to stop agent '${agent.name}'? This will terminate the agent and its current work.`,
      confirmLabel: "Stop",
      variant: "danger",
    });
    if (ok) stopAgent(agent.id);
  };

  return (
    <div className="agent-header">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="dash-brand back-btn" onClick={deselectAgent} aria-label="Back to dashboard">
          <img src="/icons/icon.svg" alt="" className="dash-brand-logo" />
          <span>Autosclaw</span>
        </button>
        <div className="agent-title">
          <h2>{agent.name}</h2>
          <span className={`status-dot ${dotClass}`} />
          <span className="status-label">{statusLabel}</span>
          {isHistory && <span className="history-badge">Read-only</span>}
        </div>
      </div>
      {canStop && (
        <button
          className="stop-btn"
          onClick={handleStop}
        >
          Stop
        </button>
      )}
      {ConfirmDialogElement}
    </div>
  );
}
