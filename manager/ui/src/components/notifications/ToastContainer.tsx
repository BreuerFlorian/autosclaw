import { useState, useCallback, useEffect, useRef } from "react";
import Toast, { type ToastData } from "./Toast";
import { useApp } from "../../context/AppContext";
import "./Toast.css";

let addToastGlobal: ((toast: Omit<ToastData, "id">) => void) | null = null;

export function showToast(toast: Omit<ToastData, "id">): void {
  addToastGlobal?.(toast);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const { state, selectAgent } = useApp();
  const currentAgentIdRef = useRef(state.currentAgentId);
  currentAgentIdRef.current = state.currentAgentId;

  const addToast = useCallback((toast: Omit<ToastData, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    addToastGlobal = addToast;
    return () => { addToastGlobal = null; };
  }, [addToast]);

  // Listen for ask_user events on agents not currently being watched
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "ask_user" && msg.agentId && msg.agentId !== currentAgentIdRef.current) {
          const agentName = msg.agentName || "An agent";
          addToast({
            message: `${agentName} is waiting for your input`,
            action: {
              label: "View",
              onClick: () => selectAgent(msg.agentId),
            },
          });
        }
      } catch { /* ignore */ }
    };

    // We can't easily subscribe to WS messages from here since they're handled
    // in AppContext. Instead, the toast is triggered from AppContext via showToast.
    // This effect is a placeholder — actual triggering happens in AppContext.
    void handler; // prevent unused warning
  }, [addToast, selectAgent]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
