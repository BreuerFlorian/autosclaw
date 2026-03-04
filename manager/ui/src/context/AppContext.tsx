import { createContext, useContext, useReducer, useRef, useCallback, useEffect, useState, type ReactNode } from "react";
import type { AppState, AppAction, Agent, Schedule, Project, OutputEntry, WsSendFn, ModalType, AskQuestion, UserRole } from "../types";
import { useAuth } from "../hooks/useAuth";
import { showToast } from "../components/notifications/ToastContainer";

function formatTimestamp(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const initialState: AppState = {
  agents: [],
  schedules: [],
  projects: [],
  currentAgentId: null,
  currentScheduleId: null,
  outputs: [],
  sidebarOpen: false,
  modal: null,
};

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_AGENTS":
      return { ...state, agents: action.agents };
    case "SET_SCHEDULES":
      return { ...state, schedules: action.schedules };
    case "SET_PROJECTS":
      return { ...state, projects: action.projects };
    case "SELECT_AGENT":
      return { ...state, currentAgentId: action.agentId, currentScheduleId: null, outputs: [], sidebarOpen: false };
    case "DESELECT_AGENT":
      return { ...state, currentAgentId: null, outputs: [] };
    case "SELECT_SCHEDULE":
      return { ...state, currentScheduleId: action.scheduleId, currentAgentId: null, outputs: [], sidebarOpen: false };
    case "DESELECT_SCHEDULE":
      return { ...state, currentScheduleId: null };
    case "ADD_OUTPUT":
      return { ...state, outputs: [...state.outputs, action.entry] };
    case "SET_OUTPUTS":
      return { ...state, outputs: action.entries };
    case "CLEAR_OUTPUTS":
      return { ...state, outputs: [] };
    case "MARK_ASK_ANSWERED":
      return {
        ...state,
        outputs: state.outputs.map((o, i) =>
          i === action.index && o.kind === "ask_user" ? { ...o, answered: true } : o
        ),
      };
    case "REMOVE_UNANSWERED_ASKS":
      return {
        ...state,
        outputs: state.outputs.filter((o) => !(o.kind === "ask_user" && !o.answered)),
      };
    case "TOGGLE_SIDEBAR":
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case "CLOSE_SIDEBAR":
      return { ...state, sidebarOpen: false };
    case "SET_MODAL":
      return { ...state, modal: action.modal };
    default:
      return state;
  }
}

type AppContextType = {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  wsSend: WsSendFn;
  selectAgent: (id: string) => void;
  deselectAgent: () => void;
  selectSchedule: (id: string) => void;
  deselectSchedule: () => void;
  sendChat: (message: string) => void;
  sendAskUserResponse: (answers: Record<string, string>) => void;
  startAgent: (name: string, permissions?: string[], projectId?: string | null) => void;
  stopAgent: (agentId: string) => void;
  stopAgents: (agentIds: string[]) => void;
  reloadService: () => void;
  openModal: (m: ModalType) => void;
  closeModal: () => void;
  token: string | null;
  login: (u: string, p: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  validating: boolean;
  connected: boolean;
  userRole: UserRole;
  userId: number | null;
};

const Ctx = createContext<AppContextType | null>(null);

export function useApp(): AppContextType {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { token, login, logout, validating, validateToken, role: userRole, userId } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const currentAgentIdRef = useRef<string | null>(null);
  const currentScheduleIdRef = useRef<string | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipPopstateRef = useRef(false);

  // Keep refs in sync
  currentAgentIdRef.current = state.currentAgentId;
  currentScheduleIdRef.current = state.currentScheduleId;

  const wsSend: WsSendFn = useCallback((msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (!token) return;
    // Close any lingering socket before opening a new one to prevent duplicates
    if (wsRef.current) {
      const prev = wsRef.current;
      wsRef.current = null;
      prev.close();
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "list_schedules" }));
      ws.send(JSON.stringify({ type: "list_projects" }));
    });

    ws.addEventListener("close", async (event) => {
      setConnected(false);
      if (event.code === 1006 || event.code === 4001) {
        const valid = await validateToken();
        if (!valid) { logout(); return; }
      }
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = setTimeout(connect, 2000);
    });

    ws.addEventListener("message", (event) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(event.data as string); } catch { return; }
      const ts = formatTimestamp();

      switch (msg.type) {
        case "agent_list":
          dispatch({ type: "SET_AGENTS", agents: msg.agents as Agent[] });
          break;

        case "text_history":
          if (msg.agentId === currentAgentIdRef.current) {
            const entries = (msg.entries as Array<Record<string, unknown>>).map((e): OutputEntry => {
              if (e.type === "tool_use") {
                if (e.toolType === "ask_user") {
                  const inp = e.input as { questions: AskQuestion[] };
                  return { kind: "ask_user", questions: inp.questions, answered: true, timestamp: ts };
                }
                return { kind: "tool_use", toolType: e.toolType as string, name: e.name as string, input: e.input, timestamp: ts };
              }
              if (e.msgType && typeof e.msgType === "string") {
                return { kind: "output", msgType: e.msgType as string, content: e.text as string, timestamp: ts };
              }
              return { kind: "text_entry", role: e.role as "user" | "assistant", text: e.text as string, timestamp: ts };
            });
            dispatch({ type: "SET_OUTPUTS", entries });
          }
          break;

        case "output":
        case "tool_use":
        case "ask_user":
          if (msg.agentId === currentAgentIdRef.current) {
            if (msg.type === "ask_user") {
              dispatch({
                type: "ADD_OUTPUT",
                entry: {
                  kind: "ask_user",
                  questions: msg.questions as OutputEntry extends { kind: "ask_user" } ? OutputEntry["questions"] : never,
                  answered: false,
                  timestamp: ts,
                },
              });
            } else if (msg.type === "tool_use") {
              dispatch({ type: "ADD_OUTPUT", entry: { kind: "tool_use", toolType: msg.toolType as string, name: msg.name as string, input: msg.input, timestamp: ts } });
            } else {
              dispatch({ type: "ADD_OUTPUT", entry: { kind: "output", msgType: msg.msgType as string, content: msg.content as string, timestamp: ts } });
            }
          }
          break;

        case "tokens":
          break;

        case "status":
          break;

        case "agent_stopped":
          if (msg.agentId === currentAgentIdRef.current) {
            dispatch({ type: "DESELECT_AGENT" });
            skipPopstateRef.current = true;
            history.back();
          }
          break;

        case "error":
          alert(msg.message);
          break;

        case "schedule_list":
          dispatch({ type: "SET_SCHEDULES", schedules: msg.schedules as Schedule[] });
          break;

        case "schedule_created": {
          ws.send(JSON.stringify({ type: "list_schedules" }));
          const sched = msg.schedule as Schedule | undefined;
          if (sched) {
            const onDashboard = !currentAgentIdRef.current && !currentScheduleIdRef.current;
            dispatch({ type: "SELECT_SCHEDULE", scheduleId: sched.id });
            if (onDashboard) {
              history.pushState({ view: "detail" }, "");
            } else {
              history.replaceState({ view: "detail" }, "");
            }
          }
          break;
        }

        case "schedule_updated": {
          ws.send(JSON.stringify({ type: "list_schedules" }));
          break;
        }

        case "schedule_deleted": {
          const deleted = msg.schedule as Schedule | undefined;
          if (deleted && deleted.id === currentScheduleIdRef.current) {
            dispatch({ type: "DESELECT_SCHEDULE" });
            skipPopstateRef.current = true;
            history.back();
          }
          ws.send(JSON.stringify({ type: "list_schedules" }));
          break;
        }

        case "schedule_error":
          alert(msg.error);
          break;

        // Project messages
        case "project_list":
          dispatch({ type: "SET_PROJECTS", projects: msg.projects as Project[] });
          break;

        case "project_created":
        case "project_updated":
        case "project_deleted":
          ws.send(JSON.stringify({ type: "list_projects" }));
          break;

        case "project_error":
          alert(msg.error);
          break;

        case "ask_user_notification": {
          const askAgentId = msg.agentId as string;
          const askAgentName = msg.agentName as string;
          if (askAgentId !== currentAgentIdRef.current) {
            showToast({
              message: `${askAgentName} is waiting for your input`,
              action: {
                label: "View",
                onClick: () => {
                  const onDashboard = !currentAgentIdRef.current && !currentScheduleIdRef.current;
                  dispatch({ type: "SELECT_AGENT", agentId: askAgentId });
                  ws.send(JSON.stringify({ type: "watch", agentId: askAgentId }));
                  if (onDashboard) {
                    history.pushState({ view: "detail" }, "");
                  } else {
                    history.replaceState({ view: "detail" }, "");
                  }
                },
              },
            });
          }
          break;
        }
      }
    });
  }, [token, logout, validateToken]);

  useEffect(() => {
    if (token && !validating) connect();
    return () => {
      clearTimeout(reconnectTimeout.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [token, validating, connect]);

  // Reconnect when the page becomes visible again (e.g. after laptop sleep / lock screen)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && token && !validating) {
        const ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          clearTimeout(reconnectTimeout.current);
          connect();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [token, validating, connect]);

  // Browser history: push when entering a detail view, pop when leaving
  const selectAgent = useCallback((id: string) => {
    const onDashboard = !currentAgentIdRef.current && !currentScheduleIdRef.current;
    dispatch({ type: "SELECT_AGENT", agentId: id });
    wsSend({ type: "watch", agentId: id });
    if (onDashboard) {
      history.pushState({ view: "detail" }, "");
    } else {
      history.replaceState({ view: "detail" }, "");
    }
  }, [wsSend]);

  const deselectAgent = useCallback(() => {
    if (!currentAgentIdRef.current) return;
    dispatch({ type: "DESELECT_AGENT" });
    skipPopstateRef.current = true;
    history.back();
  }, []);

  const selectSchedule = useCallback((id: string) => {
    const onDashboard = !currentAgentIdRef.current && !currentScheduleIdRef.current;
    dispatch({ type: "SELECT_SCHEDULE", scheduleId: id });
    if (onDashboard) {
      history.pushState({ view: "detail" }, "");
    } else {
      history.replaceState({ view: "detail" }, "");
    }
  }, []);

  const deselectSchedule = useCallback(() => {
    if (!currentScheduleIdRef.current) return;
    dispatch({ type: "DESELECT_SCHEDULE" });
    skipPopstateRef.current = true;
    history.back();
  }, []);

  // Handle browser back button
  useEffect(() => {
    const onPopState = () => {
      if (skipPopstateRef.current) {
        skipPopstateRef.current = false;
        return;
      }
      if (currentAgentIdRef.current) {
        dispatch({ type: "DESELECT_AGENT" });
      } else if (currentScheduleIdRef.current) {
        dispatch({ type: "DESELECT_SCHEDULE" });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const sendChat = useCallback((message: string) => {
    if (!message || !currentAgentIdRef.current) return;
    wsSend({ type: "chat", agentId: currentAgentIdRef.current, message });
  }, [wsSend]);

  const sendAskUserResponse = useCallback((answers: Record<string, string>) => {
    if (!currentAgentIdRef.current) return;
    wsSend({ type: "ask_user_response", agentId: currentAgentIdRef.current, answers });
  }, [wsSend]);

  const startAgent = useCallback((name: string, permissions?: string[], projectId?: string | null) => {
    const msg: Record<string, unknown> = { type: "start_agent", name, permissions: permissions ?? [] };
    if (projectId) msg.projectId = projectId;
    wsSend(msg);
  }, [wsSend]);

  const stopAgent = useCallback((agentId: string) => {
    wsSend({ type: "stop_agent", agentId });
  }, [wsSend]);

  const stopAgents = useCallback((agentIds: string[]) => {
    wsSend({ type: "stop_agents", agentIds });
  }, [wsSend]);

  const reloadService = useCallback(() => {
    wsSend({ type: "reload_service" });
  }, [wsSend]);

  const openModal = useCallback((m: ModalType) => {
    dispatch({ type: "SET_MODAL", modal: m });
  }, []);

  const closeModal = useCallback(() => {
    dispatch({ type: "SET_MODAL", modal: null });
  }, []);

  return (
    <Ctx.Provider value={{
      state, dispatch, wsSend, selectAgent, deselectAgent, selectSchedule,
      deselectSchedule, sendChat, sendAskUserResponse, startAgent, stopAgent, stopAgents, reloadService, openModal, closeModal,
      token, login, logout, validating, connected, userRole, userId,
    }}>
      {children}
    </Ctx.Provider>
  );
}
