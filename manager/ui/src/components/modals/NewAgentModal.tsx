import { useState } from "react";
import { useApp } from "../../context/AppContext";
import Modal from "./Modal";

export default function NewAgentModal() {
  const { state, startAgent, closeModal } = useApp();
  const open = state.modal === "newAgent";
  const defaultName = `Agent ${state.agents.length + 1}`;
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [canSpawn, setCanSpawn] = useState(true);
  const [canSchedule, setCanSchedule] = useState(true);
  const [projectId, setProjectId] = useState("");

  const handleCreate = () => {
    if (creating) return;
    setCreating(true);
    const agentName = name.trim() || defaultName;
    const permissions: string[] = [];
    if (canSpawn) permissions.push("agent:spawn");
    if (canSchedule) permissions.push("agent:schedule");
    startAgent(agentName, permissions, projectId || null);
    setName("");
    setCanSpawn(true);
    setCanSchedule(true);
    setProjectId("");
    setCreating(false);
    closeModal();
  };

  const handleClose = () => {
    setName("");
    setCanSpawn(true);
    setCanSchedule(true);
    setProjectId("");
    closeModal();
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <h3>New Agent</h3>
      <div className="form-group">
        <label htmlFor="new-agent-name">Agent Name</label>
        <input
          id="new-agent-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={defaultName}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
          autoFocus
        />
      </div>
      {state.projects.length > 0 && (
        <div className="form-group">
          <label htmlFor="new-agent-project">Project</label>
          <select
            id="new-agent-project"
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
        <button className="modal-submit" onClick={handleCreate} disabled={creating}>
          {creating ? "Creating\u2026" : "Create"}
        </button>
      </div>
    </Modal>
  );
}
