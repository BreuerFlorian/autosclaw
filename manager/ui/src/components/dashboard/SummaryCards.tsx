import { useApp } from "../../context/AppContext";
import "./SummaryCards.css";

export default function SummaryCards() {
  const { state } = useApp();
  const { agents, schedules } = state;

  const totalAgents = agents.filter((a) => a.status !== "deleted").length;
  const runningAgents = agents.filter(
    (a) => a.status === "running" || a.status === "starting"
  ).length;
  const totalSchedules = schedules.length;

  return (
    <div className="dash-summary">
      <div className="summary-card">
        <div className="summary-icon icon-accent">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8" />
            <path d="M12 17v4" />
          </svg>
        </div>
        <div className="summary-data">
          <span className="summary-value">{totalAgents}</span>
          <span className="summary-label">Total Agents</span>
        </div>
      </div>

      <div className="summary-card">
        <div className="summary-icon icon-green">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polygon points="10 8 16 12 10 16 10 8" />
          </svg>
        </div>
        <div className="summary-data">
          <span className="summary-value">{runningAgents}</span>
          <span className="summary-label">Running</span>
        </div>
      </div>

      <div className="summary-card">
        <div className="summary-icon icon-magenta">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4" />
            <path d="M8 2v4" />
            <path d="M3 10h18" />
          </svg>
        </div>
        <div className="summary-data">
          <span className="summary-value">{totalSchedules}</span>
          <span className="summary-label">Schedules</span>
        </div>
      </div>
    </div>
  );
}
