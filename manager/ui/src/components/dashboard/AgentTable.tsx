import { useState, useEffect, type MouseEvent } from "react";
import { useApp } from "../../context/AppContext";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useTableSort, sortItems, sortIndicator } from "../../hooks/useTableSort";
import { fmtCompact, fmtCost } from "../../utils";
import type { Agent, Project } from "../../types";
import AgentCard from "./AgentCard";
import "./AgentTable.css";

function agentDisplayStatus(agent: Agent): string {
  if (agent.status === "deleted") return "deleted";
  if (agent.waitingForAskUser && agent.status === "running") return "waiting";
  if (agent.processing && agent.status === "running") return "processing";
  return agent.status;
}

function canStopBase(agent: Agent): boolean {
  return agent.status === "running" || agent.status === "starting";
}

function ProjectBadge({ projectId, projects }: { projectId?: string | null; projects: Project[] }) {
  if (!projectId) return null;
  const project = projects.find((p) => p.id === projectId);
  return <span className="project-badge" title={project ? `Project: ${project.name}` : "Project (deleted)"}>{project?.name ?? "?"}</span>;
}

type ColKey = "name" | "status" | "input" | "output" | "cacheR" | "cacheW" | "cost";

const colGetters: Record<ColKey, (a: Agent) => string | number> = {
  name: (a) => a.name.toLowerCase(),
  status: (a) => agentDisplayStatus(a),
  input: (a) => a.inputTokens,
  output: (a) => a.outputTokens,
  cacheR: (a) => a.cacheReadInputTokens,
  cacheW: (a) => a.cacheCreationInputTokens,
  cost: (a) => a.costUSD,
};

export default function AgentTable() {
  const { state, selectAgent, stopAgent, stopAgents, openModal, userRole, userId } = useApp();
  const { confirm, ConfirmDialogElement } = useConfirmDialog();
  const { agents, projects } = state;
  const { sort, toggle } = useTableSort<ColKey>("name");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleted, setShowDeleted] = useState(false);

  const canStopAgent = (agent: Agent): boolean => {
    if (!canStopBase(agent)) return false;
    if (userRole === "viewer") return false;
    if (userRole === "admin") return true;
    return agent.createdBy === userId;
  };

  const canSpawn = userRole === "admin" || userRole === "member";
  const activeAgents = agents.filter((a) => a.status !== "deleted");
  const deletedAgents = agents.filter((a) => a.status === "deleted");
  const sorted = sortItems(activeAgents, sort, colGetters);
  const sortedDeleted = sortItems(deletedAgents, sort, colGetters);
  const stoppableAgents = agents.filter(canStopAgent);
  const hasActions = stoppableAgents.length > 0;

  // Clean up stale selections when agents change
  useEffect(() => {
    setSelected((prev) => {
      const runningIds = new Set(stoppableAgents.map((a) => a.id));
      const next = new Set([...prev].filter((id) => runningIds.has(id)));
      if (next.size !== prev.size) return next;
      return prev;
    });
  }, [agents]);

  const toggleSelect = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === stoppableAgents.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(stoppableAgents.map((a) => a.id)));
    }
  };

  const handleStopAll = async () => {
    const ok = await confirm({
      title: "Stop All Agents",
      message: `Are you sure you want to stop all ${stoppableAgents.length} running agent${stoppableAgents.length === 1 ? "" : "s"}? This will terminate their current work.`,
      confirmLabel: "Stop All",
      variant: "danger",
    });
    if (ok) {
      stopAgents(stoppableAgents.map((a) => a.id));
    }
  };

  const handleStopSelected = async () => {
    const selectedRunning = stoppableAgents.filter((a) => selected.has(a.id));
    if (selectedRunning.length === 0) return;
    const ok = await confirm({
      title: "Stop Selected Agents",
      message: `Are you sure you want to stop ${selectedRunning.length} selected agent${selectedRunning.length === 1 ? "" : "s"}? This will terminate their current work.`,
      confirmLabel: "Stop Selected",
      variant: "danger",
    });
    if (ok) {
      stopAgents(selectedRunning.map((a) => a.id));
      setSelected(new Set());
    }
  };

  const handleStopAgent = async (agent: Agent) => {
    const ok = await confirm({
      title: "Stop Agent",
      message: `Are you sure you want to stop agent '${agent.name}'? This will terminate its current work.`,
      confirmLabel: "Stop",
      variant: "danger",
    });
    if (ok) {
      stopAgent(agent.id);
    }
  };

  const handleStopOne = (e: MouseEvent, agent: Agent) => {
    e.stopPropagation();
    handleStopAgent(agent);
  };

  const th = (key: ColKey, label: string, className?: string) => (
    <th className={`dash-sortable ${className ?? ""}`} onClick={() => toggle(key)}>
      {label}{sortIndicator(sort, key)}
    </th>
  );

  const renderAgentRow = (agent: Agent) => {
    const display = agentDisplayStatus(agent);
    const stoppable = canStopAgent(agent);
    const isDeleted = agent.status === "deleted";
    return (
      <tr
        key={agent.id}
        className={`dash-agent-row${isDeleted ? " dash-agent-deleted" : ""}`}
        onClick={() => selectAgent(agent.id)}
      >
        {hasActions && (
          <td className="dash-check-cell">
            {stoppable && (
              <input
                type="checkbox"
                checked={selected.has(agent.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleSelect(agent.id, { stopPropagation: () => {} } as MouseEvent)}
              />
            )}
          </td>
        )}
        <td>
          <span className={`dash-agent-dot ${display}`} />
          {agent.name}
          <ProjectBadge projectId={agent.projectId} projects={projects} />
        </td>
        <td>
          <span className={`dash-status-badge ${display}`}>{display}</span>
        </td>
        <td>{fmtCompact(agent.inputTokens)}</td>
        <td>{fmtCompact(agent.outputTokens)}</td>
        <td>{fmtCompact(agent.cacheReadInputTokens)}</td>
        <td>{fmtCompact(agent.cacheCreationInputTokens)}</td>
        <td className="dash-cost">{fmtCost(agent.costUSD)}</td>
        {hasActions && (
          <td className="dash-actions-cell">
            {stoppable && (
              <button
                className="dash-action-btn delete"
                onClick={(e) => handleStopOne(e, agent)}
              >
                Stop
              </button>
            )}
          </td>
        )}
      </tr>
    );
  };

  return (
    <div className="dash-section">
      <div className="dash-section-header">
        <h3>Agents</h3>
        <div className="dash-agent-actions">
          {hasActions && selected.size > 0 && (
            <button className="dash-stop-selected-btn" onClick={handleStopSelected}>
              Stop Selected ({selected.size})
            </button>
          )}
          {hasActions && (
            <button className="dash-stop-all-btn" onClick={handleStopAll}>
              Stop All ({stoppableAgents.length})
            </button>
          )}
          {canSpawn && (
            <button
              className="dash-new-agent-btn"
              onClick={() => openModal("newAgent")}
            >
              + New Agent
            </button>
          )}
        </div>
      </div>
      <div className="dash-table-wrap">
        {activeAgents.length === 0 && !showDeleted ? (
          <div className="dash-empty">No agents yet</div>
        ) : (
          <table className="dash-table">
            <thead>
              <tr>
                {hasActions && (
                  <th className="dash-check-th">
                    <input
                      type="checkbox"
                      checked={selected.size === stoppableAgents.length && stoppableAgents.length > 0}
                      onChange={toggleSelectAll}
                    />
                  </th>
                )}
                {th("name", "Agent")}
                {th("status", "Status")}
                {th("input", "Input")}
                {th("output", "Output")}
                {th("cacheR", "Cache R")}
                {th("cacheW", "Cache W")}
                {th("cost", "Cost")}
                {hasActions && <th className="dash-actions-th">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map(renderAgentRow)}
              {showDeleted && deletedAgents.length > 0 && (
                <>
                  <tr className="dash-deleted-separator">
                    <td colSpan={hasActions ? 10 : 8}>Deleted Agents</td>
                  </tr>
                  {sortedDeleted.map(renderAgentRow)}
                </>
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="dash-card-list">
        {sorted.map((agent) => {
          const display = agentDisplayStatus(agent);
          const stoppable = canStopAgent(agent);
          return (
            <AgentCard
              key={agent.id}
              agent={agent}
              displayStatus={display}
              onSelect={() => selectAgent(agent.id)}
              onStop={stoppable ? () => handleStopAgent(agent) : undefined}
              projectName={agent.projectId ? projects.find((p) => p.id === agent.projectId)?.name : undefined}
            />
          );
        })}
        {activeAgents.length === 0 && (
          <div className="dash-empty">No agents yet</div>
        )}
        {showDeleted && sortedDeleted.map((agent) => {
          const display = agentDisplayStatus(agent);
          return (
            <AgentCard
              key={agent.id}
              agent={agent}
              displayStatus={display}
              onSelect={() => selectAgent(agent.id)}
              projectName={agent.projectId ? projects.find((p) => p.id === agent.projectId)?.name : undefined}
            />
          );
        })}
      </div>
      {deletedAgents.length > 0 && (
        <button className="dash-toggle-deleted" onClick={() => setShowDeleted(!showDeleted)}>
          {showDeleted ? "Hide" : "Show"} Deleted ({deletedAgents.length})
        </button>
      )}
      {ConfirmDialogElement}
    </div>
  );
}
