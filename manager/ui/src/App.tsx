import { Component, type ReactNode, type ErrorInfo } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import LoginOverlay from "./components/auth/LoginOverlay";
import Dashboard from "./components/dashboard/Dashboard";
import { AgentHeader } from "./components/agent/AgentHeader";
import { TokenBar } from "./components/agent/TokenBar";
import { OutputArea } from "./components/agent/OutputArea";
import { ChatBar } from "./components/agent/ChatBar";
import ScheduleDetail from "./components/schedule/ScheduleDetail";
import NewAgentModal from "./components/modals/NewAgentModal";
import NewScheduleModal from "./components/modals/NewScheduleModal";
import ToastContainer from "./components/notifications/ToastContainer";
import InstallPrompt from "./components/pwa/InstallPrompt";
import "./App.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: "1rem" }}>
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred. Please reload the page.</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { state, token, validating } = useApp();
  const { currentAgentId, currentScheduleId } = state;

  if (validating) {
    return <div className="app-loading"><div className="app-loading-brand">Autosclaw</div></div>;
  }

  if (!token) {
    return <LoginOverlay />;
  }

  return (
    <>
      <div className="app-layout">
        <main className="main-panel">
          {currentAgentId ? (
            <>
              <AgentHeader />
              <TokenBar />
              <OutputArea />
              <ChatBar />
            </>
          ) : currentScheduleId ? (
            <ScheduleDetail />
          ) : (
            <div className="dashboard-scroll">
              <Dashboard />
            </div>
          )}
        </main>
      </div>
      <NewAgentModal />
      <NewScheduleModal />
      <ToastContainer />
      <InstallPrompt />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </AppProvider>
  );
}
