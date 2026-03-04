import { useState, useEffect, useCallback } from "react";
import { useApp } from "../../context/AppContext";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import SummaryCards from "./SummaryCards";
import TokenSummary from "./TokenSummary";
import AgentTable from "./AgentTable";
import ScheduleTable from "./ScheduleTable";
import AgentUsageTable from "./AgentUsageTable";
import NotificationSettings from "../settings/NotificationSettings";
import ProjectsPanel from "./ProjectsPanel";
import BottomNav from "../navigation/BottomNav";
import type { UserRole } from "../../types";
import "./Dashboard.css";

type DashTab = "agents" | "usage" | "projects" | "users";

type UserEntry = {
  id: number;
  username: string;
  role: UserRole;
  created_at: string;
};

function UsersPanel({ token }: { token: string | null }) {
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/auth/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (userId: number, newRole: UserRole) => {
    if (!token) return;
    try {
      const res = await fetch(`/auth/users/${userId}/role`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
        );
      }
    } catch { /* ignore */ }
  };

  if (loading) return <div className="dash-empty">Loading users...</div>;

  return (
    <div className="dash-section">
      <div className="dash-section-header">
        <h3>Users</h3>
      </div>
      <div className="dash-table-wrap">
        {users.length === 0 ? (
          <div className="dash-empty">No users</div>
        ) : (
          <table className="dash-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>
                    <select
                      value={user.role}
                      onChange={(e) =>
                        handleRoleChange(user.id, e.target.value as UserRole)
                      }
                    >
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </td>
                  <td>{new Date(user.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="dash-card-list">
        {users.length === 0 ? (
          <div className="dash-empty">No users</div>
        ) : (
          users.map((user) => (
            <div key={user.id} className="user-card">
              <div className="user-card-top">
                <span className="user-card-name">{user.username}</span>
                <span className={`dash-role-badge ${user.role}`}>{user.role}</span>
              </div>
              <div className="user-card-details">
                <select
                  value={user.role}
                  onChange={(e) =>
                    handleRoleChange(user.id, e.target.value as UserRole)
                  }
                  className="user-card-select"
                >
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                  <option value="viewer">viewer</option>
                </select>
                <span className="user-card-date">
                  Joined {new Date(user.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { reloadService, logout, userRole, token } = useApp();
  const { confirm, ConfirmDialogElement } = useConfirmDialog();
  const [reloading, setReloading] = useState(false);
  const [activeTab, setActiveTab] = useState<DashTab>("agents");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isAdmin = userRole === "admin";

  async function handleReload() {
    const ok = await confirm({
      title: "Reload Service",
      message: "This will pull the latest code, reinstall dependencies, and restart the service. All running agents will be stopped. Continue?",
      confirmLabel: "Reload",
      variant: "warning",
    });
    if (!ok) return;
    setReloading(true);
    reloadService();
  }

  return (
    <div className="dashboard">
      <div className="dash-header">
        <button className="dash-brand" onClick={() => setActiveTab("agents")}>
          <img src="/icons/icon.svg" alt="" className="dash-brand-logo" />
          <h2>Autosclaw</h2>
          <span className="dash-role-badge">{userRole}</span>
        </button>
        <div className="dash-header-actions">
          {isAdmin && (
            <button
              className="reload-service-btn"
              disabled={reloading}
              onClick={handleReload}
            >
              {reloading ? "Reloading\u2026" : "Reload Service"}
            </button>
          )}
          <button className="dash-settings-btn" onClick={() => setSettingsOpen(true)} title="Notification settings">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.5"/><path d="M13.5 8a5.5 5.5 0 01-.4 2.05l1.2 1.2a.5.5 0 01-.05.74l-1.1.66a.5.5 0 01-.65-.12L11.5 11.3a5.5 5.5 0 01-1.75 1l.15 1.5a.5.5 0 01-.4.55l-1.3.2a.5.5 0 01-.55-.35L7.2 12.8a5.5 5.5 0 01-2-.05l-.95 1.25a.5.5 0 01-.65.12l-1.1-.66a.5.5 0 01-.05-.74l1.05-1.1A5.5 5.5 0 012.5 8c0-.7.13-1.38.38-2L1.8 4.85a.5.5 0 01.05-.74l1.1-.66a.5.5 0 01.65.12l.95 1.23a5.5 5.5 0 012-.05l.45-1.4a.5.5 0 01.55-.35l1.3.2a.5.5 0 01.4.55l-.15 1.5a5.5 5.5 0 011.75 1l.95-1.25a.5.5 0 01.65-.12l1.1.66a.5.5 0 01.05.74l-1.2 1.2c.27.64.4 1.33.4 2.02z" stroke="currentColor" strokeWidth="1.3"/></svg>
          </button>
          <button className="dash-logout-btn" onClick={logout}>Logout</button>
        </div>
      </div>
      <div className="dash-tabs">
        <button
          className={`dash-tab${activeTab === "agents" ? " active" : ""}`}
          onClick={() => setActiveTab("agents")}
        >
          Agents
        </button>
        <button
          className={`dash-tab${activeTab === "usage" ? " active" : ""}`}
          onClick={() => setActiveTab("usage")}
        >
          Usage
        </button>
        <button
          className={`dash-tab${activeTab === "projects" ? " active" : ""}`}
          onClick={() => setActiveTab("projects")}
        >
          Projects
        </button>
        {isAdmin && (
          <button
            className={`dash-tab${activeTab === "users" ? " active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            Users
          </button>
        )}
      </div>
      {activeTab === "agents" && (
        <>
          <SummaryCards />
          <AgentTable />
          <ScheduleTable />
        </>
      )}
      {activeTab === "usage" && (
        <>
          <TokenSummary />
          <AgentUsageTable />
        </>
      )}
      {activeTab === "projects" && (
        <ProjectsPanel />
      )}
      {activeTab === "users" && isAdmin && (
        <UsersPanel token={token} />
      )}
      {ConfirmDialogElement}
      <NotificationSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} isAdmin={isAdmin} />
    </div>
  );
}
