import { useState } from "react";
import { useApp } from "../../context/AppContext";
import { useTableSort, sortItems, sortIndicator } from "../../hooks/useTableSort";
import { fmtCompact, fmtCost } from "../../utils";
import type { Agent } from "../../types";
import "./AgentUsageTable.css";

const PAGE_SIZE = 10;

type ColKey = "name" | "status" | "input" | "output" | "cacheRead" | "cacheWrite" | "cost";

const colGetters: Record<ColKey, (a: Agent) => string | number> = {
  name: (a) => a.name.toLowerCase(),
  status: (a) => a.status,
  input: (a) => a.inputTokens,
  output: (a) => a.outputTokens,
  cacheRead: (a) => a.cacheReadInputTokens,
  cacheWrite: (a) => a.cacheCreationInputTokens,
  cost: (a) => a.costUSD,
};

export default function AgentUsageTable() {
  const { state, selectAgent } = useApp();
  const { agents, projects } = state;
  const [page, setPage] = useState(0);
  const { sort, toggle } = useTableSort<ColKey>("cost", "desc");

  const sorted = sortItems(agents, sort, colGetters);

  const totalInput = agents.reduce((s, a) => s + a.inputTokens, 0);
  const totalOutput = agents.reduce((s, a) => s + a.outputTokens, 0);
  const totalCacheRead = agents.reduce((s, a) => s + a.cacheReadInputTokens, 0);
  const totalCacheWrite = agents.reduce((s, a) => s + a.cacheCreationInputTokens, 0);
  const totalCost = agents.reduce((s, a) => s + a.costUSD, 0);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageAgents = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const th = (key: ColKey, label: string, className?: string) => (
    <th className={`dash-sortable ${className ?? ""}`} onClick={() => { toggle(key); setPage(0); }}>
      {label}{sortIndicator(sort, key)}
    </th>
  );

  if (agents.length === 0) {
    return (
      <div className="dash-section">
        <h3>Per-Agent Usage</h3>
        <div className="dash-table-wrap">
          <div className="dash-empty">No agents yet</div>
        </div>
        <div className="dash-card-list">
          <div className="dash-empty">No agents yet</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-section">
      <div className="dash-section-header">
        <h3>
          Per-Agent Usage
          {totalCost > 0 && (
            <span className="dash-total-cost">Total: {fmtCost(totalCost)}</span>
          )}
        </h3>
      </div>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              {th("name", "Agent")}
              {th("status", "Status")}
              {th("input", "Input", "usage-num-col")}
              {th("output", "Output", "usage-num-col")}
              {th("cacheRead", "Cache Read", "usage-num-col")}
              {th("cacheWrite", "Cache Write", "usage-num-col")}
              {th("cost", "Cost", "usage-num-col")}
            </tr>
          </thead>
          <tbody>
            {pageAgents.map((agent) => (
              <tr
                key={agent.id}
                className={`usage-row${agent.status === "deleted" ? " dash-agent-deleted" : ""}`}
              >
                <td>
                  <span className={`dash-agent-dot ${agent.status}`} />
                  <span
                    className="usage-agent-name"
                    onClick={() => selectAgent(agent.id)}
                  >
                    {agent.name}
                  </span>
                  {agent.projectId && (() => {
                    const p = projects.find((pr) => pr.id === agent.projectId);
                    return p ? <span className="project-badge">{p.name}</span> : null;
                  })()}
                </td>
                <td>
                  <span className={`dash-status-badge ${agent.status}`}>
                    {agent.status}
                  </span>
                </td>
                <td className="usage-num-col">{fmtCompact(agent.inputTokens)}</td>
                <td className="usage-num-col">{fmtCompact(agent.outputTokens)}</td>
                <td className="usage-num-col">{fmtCompact(agent.cacheReadInputTokens)}</td>
                <td className="usage-num-col">{fmtCompact(agent.cacheCreationInputTokens)}</td>
                <td className="usage-num-col dash-cost">{fmtCost(agent.costUSD)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="usage-totals-row">
              <td colSpan={2}><strong>Total</strong></td>
              <td className="usage-num-col">{fmtCompact(totalInput)}</td>
              <td className="usage-num-col">{fmtCompact(totalOutput)}</td>
              <td className="usage-num-col">{fmtCompact(totalCacheRead)}</td>
              <td className="usage-num-col">{fmtCompact(totalCacheWrite)}</td>
              <td className="usage-num-col dash-cost">{fmtCost(totalCost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="dash-card-list">
        {pageAgents.map((agent) => (
          <div
            key={agent.id}
            className={`usage-card${agent.status === "deleted" ? " usage-card-deleted" : ""}`}
            onClick={() => selectAgent(agent.id)}
          >
            <div className="usage-card-top">
              <span className={`dash-agent-dot ${agent.status}`} />
              <span className="usage-card-name">{agent.name}</span>
              <span className={`dash-status-badge ${agent.status}`}>{agent.status}</span>
            </div>
            <div className="usage-card-stats">
              <div className="usage-card-stat">
                <span className="usage-card-stat-label">Input</span>
                <span className="usage-card-stat-value">{fmtCompact(agent.inputTokens)}</span>
              </div>
              <div className="usage-card-stat">
                <span className="usage-card-stat-label">Output</span>
                <span className="usage-card-stat-value">{fmtCompact(agent.outputTokens)}</span>
              </div>
              <div className="usage-card-stat">
                <span className="usage-card-stat-label">Cost</span>
                <span className="usage-card-stat-value cost">{fmtCost(agent.costUSD)}</span>
              </div>
            </div>
          </div>
        ))}
        {totalCost > 0 && (
          <div className="usage-card usage-card-total">
            <div className="usage-card-stats">
              <div className="usage-card-stat">
                <span className="usage-card-stat-label">Total Input</span>
                <span className="usage-card-stat-value">{fmtCompact(totalInput)}</span>
              </div>
              <div className="usage-card-stat">
                <span className="usage-card-stat-label">Total Output</span>
                <span className="usage-card-stat-value">{fmtCompact(totalOutput)}</span>
              </div>
              <div className="usage-card-stat">
                <span className="usage-card-stat-label">Total Cost</span>
                <span className="usage-card-stat-value cost">{fmtCost(totalCost)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
      {totalPages > 1 && (
        <div className="usage-pagination">
          <button
            className="usage-page-btn"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            Prev
          </button>
          <span className="usage-page-info">
            {safePage + 1} / {totalPages}
          </span>
          <button
            className="usage-page-btn"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage(safePage + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
