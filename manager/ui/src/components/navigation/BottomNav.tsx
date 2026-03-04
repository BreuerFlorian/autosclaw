import "./BottomNav.css";

type BottomNavProps = {
  activeTab: string;
  onTabChange: (tab: "agents" | "usage" | "projects" | "users") => void;
  isAdmin: boolean;
};

export default function BottomNav({ activeTab, onTabChange, isAdmin }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      <button
        className={`bottom-nav-item${activeTab === "agents" ? " active" : ""}`}
        onClick={() => onTabChange("agents")}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </svg>
        <span>Dashboard</span>
      </button>
      <button
        className={`bottom-nav-item${activeTab === "usage" ? " active" : ""}`}
        onClick={() => onTabChange("usage")}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="12" width="4" height="8" rx="1" />
          <rect x="10" y="6" width="4" height="14" rx="1" />
          <rect x="17" y="2" width="4" height="18" rx="1" />
        </svg>
        <span>Usage</span>
      </button>
      <button
        className={`bottom-nav-item${activeTab === "projects" ? " active" : ""}`}
        onClick={() => onTabChange("projects")}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
        <span>Projects</span>
      </button>
      {isAdmin && (
        <button
          className={`bottom-nav-item${activeTab === "users" ? " active" : ""}`}
          onClick={() => onTabChange("users")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M5 20c0-4 3.5-7 7-7s7 3 7 7" />
          </svg>
          <span>Users</span>
        </button>
      )}
    </nav>
  );
}
