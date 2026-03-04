import { useState, useEffect } from "react";
import { useApp } from "../../context/AppContext";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useSwipeBack } from "../../hooks/useSwipeBack";
import { formatDate } from "../../utils";
import type { Schedule } from "../../types";
import "./ScheduleDetail.css";

export default function ScheduleDetail() {
  const { state, deselectSchedule, wsSend, userRole, userId } = useApp();
  const { confirm, ConfirmDialogElement } = useConfirmDialog();
  const schedule = state.schedules.find(
    (s) => s.id === state.currentScheduleId
  );
  useSwipeBack(deselectSchedule);

  const [name, setName] = useState("");
  const [cronExpression, setCronExpression] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentPurpose, setAgentPurpose] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [canSpawn, setCanSpawn] = useState(true);
  const [canSchedule, setCanSchedule] = useState(true);

  useEffect(() => {
    if (schedule) {
      setName(schedule.name);
      setCronExpression(schedule.cron_expression);
      setAgentName(schedule.agent_name);
      setAgentPurpose(schedule.agent_purpose);
      setSystemPrompt(schedule.agent_system_prompt);
      const perms = schedule.agent_permissions ? schedule.agent_permissions.split(",") : [];
      setCanSpawn(perms.includes("agent:spawn"));
      setCanSchedule(perms.includes("agent:schedule"));
    }
  }, [schedule]);

  if (!schedule) return null;

  const canModify = userRole !== "viewer" &&
    (userRole === "admin" || schedule.created_by === userId);

  const handlePauseResume = () => {
    if (schedule.status === "active") {
      wsSend({ type: "pause_schedule", scheduleId: schedule.id });
    } else {
      wsSend({ type: "resume_schedule", scheduleId: schedule.id });
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete Schedule",
      message: `Are you sure you want to delete schedule '${schedule.name}'? This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (ok) wsSend({ type: "delete_schedule", scheduleId: schedule.id });
  };

  const handleSave = () => {
    const permissions: string[] = [];
    if (canSpawn) permissions.push("agent:spawn");
    if (canSchedule) permissions.push("agent:schedule");
    wsSend({
      type: "update_schedule",
      scheduleId: schedule.id,
      name,
      cron_expression: cronExpression,
      agent_name: agentName,
      agent_purpose: agentPurpose,
      agent_system_prompt: systemPrompt,
      agent_permissions: permissions.join(","),
    });
  };

  return (
    <div className="schedule-detail">
      <div className="schedule-detail-header">
        <div className="schedule-title">
          <button className="dash-brand back-btn" onClick={deselectSchedule} aria-label="Back to dashboard">
            <img src="/icons/icon.svg" alt="" className="dash-brand-logo" />
            <span>Autosclaw</span>
          </button>
          <h2>{schedule.name}</h2>
        </div>
        {canModify && (
          <div className="schedule-detail-actions">
            {schedule.status === "active" ? (
              <button
                className="schedule-action-btn pause"
                onClick={handlePauseResume}
              >
                Pause
              </button>
            ) : (
              <button
                className="schedule-action-btn resume"
                onClick={handlePauseResume}
              >
                Resume
              </button>
            )}
            <button
              className="schedule-action-btn delete"
              onClick={handleDelete}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="schedule-form">
        <div className="form-group">
          <label htmlFor="schedule-name">Name</label>
          <input
            id="schedule-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Schedule name"
            disabled={!canModify}
          />
        </div>

        <div className="form-group">
          <label htmlFor="schedule-cron">Cron Expression (UTC)</label>
          <input
            id="schedule-cron"
            type="text"
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            placeholder="*/30 * * * *"
            disabled={!canModify}
          />
          {schedule.next_run_at && (
            <span className="form-hint">
              Next run: {formatDate(schedule.next_run_at)}
            </span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="schedule-agent-name">Agent Name</label>
          <input
            id="schedule-agent-name"
            type="text"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="Agent name"
            disabled={!canModify}
          />
        </div>

        <div className="form-group">
          <label htmlFor="schedule-agent-purpose">Agent Purpose</label>
          <input
            id="schedule-agent-purpose"
            type="text"
            value={agentPurpose}
            onChange={(e) => setAgentPurpose(e.target.value)}
            placeholder="What this agent does"
            disabled={!canModify}
          />
        </div>

        <div className="form-group">
          <label htmlFor="schedule-system-prompt">System Prompt</label>
          <textarea
            id="schedule-system-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="System prompt for the agent"
            rows={4}
            disabled={!canModify}
          />
        </div>

        <div className="form-group">
          <label>Agent Permissions</label>
          <label className="checkbox-label">
            <input type="checkbox" checked={canSpawn} onChange={(e) => setCanSpawn(e.target.checked)} disabled={!canModify} />
            Can spawn agents
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={canSchedule} onChange={(e) => setCanSchedule(e.target.checked)} disabled={!canModify} />
            Can manage schedules
          </label>
        </div>

        <div className="schedule-form-footer">
          <div className="schedule-meta">
            {schedule.next_run_at && (
              <div>Next run: {formatDate(schedule.next_run_at)}</div>
            )}
            {schedule.last_run_at && (
              <div>Last run: {formatDate(schedule.last_run_at)}</div>
            )}
          </div>
          {canModify && (
            <button className="schedule-save-btn" onClick={handleSave}>
              Save Changes
            </button>
          )}
        </div>
      </div>
      {ConfirmDialogElement}
    </div>
  );
}
