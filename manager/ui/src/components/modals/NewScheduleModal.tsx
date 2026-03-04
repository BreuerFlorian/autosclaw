import { useState } from "react";
import { useApp } from "../../context/AppContext";
import Modal from "./Modal";

export default function NewScheduleModal() {
  const { state, wsSend, closeModal } = useApp();
  const open = state.modal === "newSchedule";

  const [name, setName] = useState("");
  const [cronExpression, setCronExpression] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentPurpose, setAgentPurpose] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [canSpawn, setCanSpawn] = useState(true);
  const [canSchedule, setCanSchedule] = useState(true);
  const [projectId, setProjectId] = useState("");

  const resetForm = () => {
    setName("");
    setCronExpression("");
    setAgentName("");
    setAgentPurpose("");
    setSystemPrompt("");
    setCanSpawn(true);
    setCanSchedule(true);
    setProjectId("");
  };

  const handleCreate = () => {
    if (!name.trim() || !cronExpression.trim()) return;
    const permissions: string[] = [];
    if (canSpawn) permissions.push("agent:spawn");
    if (canSchedule) permissions.push("agent:schedule");
    const msg: Record<string, unknown> = {
      type: "create_schedule",
      name: name.trim(),
      cron_expression: cronExpression.trim(),
      agent_name: agentName.trim(),
      agent_purpose: agentPurpose.trim(),
      agent_system_prompt: systemPrompt.trim(),
      agent_permissions: permissions.join(","),
    };
    if (projectId) msg.project_id = projectId;
    wsSend(msg);
    resetForm();
    closeModal();
  };

  const handleClose = () => {
    resetForm();
    closeModal();
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <h3>New Schedule</h3>

      <div className="form-group">
        <label htmlFor="new-schedule-name">Name</label>
        <input
          id="new-schedule-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My schedule"
          autoFocus
        />
      </div>

      <div className="form-group">
        <label htmlFor="new-schedule-cron">Cron Expression (UTC)</label>
        <input
          id="new-schedule-cron"
          type="text"
          value={cronExpression}
          onChange={(e) => setCronExpression(e.target.value)}
          placeholder="*/30 * * * *"
        />
      </div>

      <div className="form-group">
        <label htmlFor="new-schedule-agent-name">Agent Name</label>
        <input
          id="new-schedule-agent-name"
          type="text"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder="Agent name"
        />
      </div>

      <div className="form-group">
        <label htmlFor="new-schedule-agent-purpose">Agent Purpose</label>
        <input
          id="new-schedule-agent-purpose"
          type="text"
          value={agentPurpose}
          onChange={(e) => setAgentPurpose(e.target.value)}
          placeholder="What this agent does"
        />
      </div>

      <div className="form-group">
        <label htmlFor="new-schedule-system-prompt">System Prompt</label>
        <textarea
          id="new-schedule-system-prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="System prompt for the agent"
          rows={4}
        />
      </div>

      {state.projects.length > 0 && (
        <div className="form-group">
          <label htmlFor="new-schedule-project">Project</label>
          <select
            id="new-schedule-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">None</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="form-group">
        <label>Agent Permissions</label>
        <label className="checkbox-label">
          <input type="checkbox" checked={canSpawn} onChange={(e) => setCanSpawn(e.target.checked)} />
          Can spawn agents
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={canSchedule} onChange={(e) => setCanSchedule(e.target.checked)} />
          Can manage schedules
        </label>
      </div>

      <div className="modal-actions">
        <button className="modal-cancel" onClick={handleClose}>
          Cancel
        </button>
        <button className="modal-submit" onClick={handleCreate}>
          Create
        </button>
      </div>
    </Modal>
  );
}
