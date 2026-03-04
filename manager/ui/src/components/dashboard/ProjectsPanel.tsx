import { useState } from "react";
import { useApp } from "../../context/AppContext";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import Modal from "../modals/Modal";
import type { Project } from "../../types";
import "./ProjectsPanel.css";

function ProjectRow({ project, onEdit, onDelete }: { project: Project; onEdit: (p: Project) => void; onDelete: (p: Project) => void }) {
  return (
    <tr className="project-row" onClick={() => onEdit(project)}>
      <td><strong>{project.name}</strong></td>
      <td>{project.purpose || <span className="text-dim">—</span>}</td>
      <td className="project-token-cell">
        {project.github_token ? (
          <code className="project-token-masked">{project.github_token}</code>
        ) : (
          <span className="text-dim">Not set</span>
        )}
      </td>
      <td className="project-actions-cell">
        <button className="dash-action-btn edit" onClick={(e) => { e.stopPropagation(); onEdit(project); }}>Edit</button>
        <button className="dash-action-btn delete" onClick={(e) => { e.stopPropagation(); onDelete(project); }}>Delete</button>
      </td>
    </tr>
  );
}

function ProjectCard({ project, onEdit, onDelete }: { project: Project; onEdit: (p: Project) => void; onDelete: (p: Project) => void }) {
  return (
    <div className="project-card" onClick={() => onEdit(project)}>
      <div className="project-card-top">
        <span className="project-card-name">{project.name}</span>
        <span className="project-card-token">
          {project.github_token ? <code>{project.github_token}</code> : <span className="text-dim">No token</span>}
        </span>
      </div>
      {project.purpose && <div className="project-card-purpose">{project.purpose}</div>}
      <div className="project-card-actions">
        <button className="dash-action-btn edit" onClick={(e) => { e.stopPropagation(); onEdit(project); }}>Edit</button>
        <button className="dash-action-btn delete" onClick={(e) => { e.stopPropagation(); onDelete(project); }}>Delete</button>
      </div>
    </div>
  );
}

export default function ProjectsPanel() {
  const { state, wsSend, userRole } = useApp();
  const { confirm, ConfirmDialogElement } = useConfirmDialog();
  const { projects } = state;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [tokenChanged, setTokenChanged] = useState(false);

  const canModify = userRole === "admin" || userRole === "member";

  const openCreate = () => {
    setEditingProject(null);
    setName("");
    setPurpose("");
    setGithubToken("");
    setTokenChanged(false);
    setModalOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditingProject(project);
    setName(project.name);
    setPurpose(project.purpose);
    setGithubToken("");
    setTokenChanged(false);
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    if (editingProject) {
      const msg: Record<string, unknown> = {
        type: "update_project",
        projectId: editingProject.id,
        name: name.trim(),
        purpose: purpose.trim(),
      };
      if (tokenChanged) {
        msg.github_token = githubToken.trim();
      }
      wsSend(msg);
    } else {
      wsSend({
        type: "create_project",
        name: name.trim(),
        purpose: purpose.trim(),
        github_token: githubToken.trim(),
      });
    }
    setModalOpen(false);
  };

  const handleDelete = async (project: Project) => {
    const ok = await confirm({
      title: "Delete Project",
      message: `Are you sure you want to delete project '${project.name}'? Agents and schedules associated with this project will keep their association but the project will be removed.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (ok) {
      wsSend({ type: "delete_project", projectId: project.id });
    }
  };

  return (
    <div className="dash-section">
      <div className="dash-section-header">
        <h3>Projects</h3>
        {canModify && (
          <button className="dash-new-agent-btn" onClick={openCreate}>
            + New Project
          </button>
        )}
      </div>
      <div className="dash-table-wrap">
        {projects.length === 0 ? (
          <div className="dash-empty">No projects yet</div>
        ) : (
          <table className="dash-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Purpose</th>
                <th>GitHub Token</th>
                {canModify && <th className="project-actions-th">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <ProjectRow key={p.id} project={p} onEdit={openEdit} onDelete={handleDelete} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="dash-card-list">
        {projects.length === 0 ? (
          <div className="dash-empty">No projects yet</div>
        ) : (
          projects.map((p) => (
            <ProjectCard key={p.id} project={p} onEdit={openEdit} onDelete={handleDelete} />
          ))
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <h3>{editingProject ? "Edit Project" : "New Project"}</h3>
        <div className="form-group">
          <label htmlFor="project-name">Name</label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Project"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label htmlFor="project-purpose">Purpose</label>
          <textarea
            id="project-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="What this project is about"
            rows={3}
          />
        </div>
        <div className="form-group">
          <label htmlFor="project-github-token">
            GitHub OAuth Token
            {editingProject && editingProject.github_token && !tokenChanged && (
              <span className="form-hint" style={{ marginLeft: 8 }}>
                Current: <code>{editingProject.github_token}</code>
              </span>
            )}
          </label>
          <input
            id="project-github-token"
            type="password"
            value={githubToken}
            onChange={(e) => { setGithubToken(e.target.value); setTokenChanged(true); }}
            placeholder={editingProject ? "Enter new token to update" : "ghp_..."}
          />
        </div>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={() => setModalOpen(false)}>Cancel</button>
          <button className="modal-submit" onClick={handleSave}>{editingProject ? "Save" : "Create"}</button>
        </div>
      </Modal>

      {ConfirmDialogElement}
    </div>
  );
}
