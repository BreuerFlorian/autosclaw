import { fmtCompact, fmtCost } from "../../utils";
import type { Agent } from "../../types";
import "./AgentCard.css";

type AgentCardProps = {
  agent: Agent;
  displayStatus: string;
  onSelect: () => void;
  onStop?: () => void;
  projectName?: string;
};

export default function AgentCard({ agent, displayStatus, onSelect, onStop, projectName }: AgentCardProps) {
  return (
    <div className={`agent-card${displayStatus === "deleted" ? " agent-card-deleted" : ""}`} onClick={onSelect}>
      <div className="agent-card-top">
        <span className={`dash-agent-dot ${displayStatus}`} />
        <span className="agent-card-name">{agent.name}</span>
        {projectName && <span className="project-badge">{projectName}</span>}
        <span className={`dash-status-badge ${displayStatus}`}>{displayStatus}</span>
      </div>
      <div className="agent-card-stats">
        <div className="agent-card-stat">
          <span className="agent-card-stat-label">Input</span>
          <span className="agent-card-stat-value">{fmtCompact(agent.inputTokens)}</span>
        </div>
        <div className="agent-card-stat">
          <span className="agent-card-stat-label">Output</span>
          <span className="agent-card-stat-value">{fmtCompact(agent.outputTokens)}</span>
        </div>
        <div className="agent-card-stat">
          <span className="agent-card-stat-label">Cost</span>
          <span className="agent-card-stat-value cost">{fmtCost(agent.costUSD)}</span>
        </div>
        {onStop && (
          <button
            className="agent-card-stop"
            onClick={(e) => { e.stopPropagation(); onStop(); }}
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
