import { useEffect, useState } from "react";
import "./Toast.css";

export type ToastData = {
  id: string;
  message: string;
  action?: { label: string; onClick: () => void };
};

type ToastProps = {
  toast: ToastData;
  onDismiss: (id: string) => void;
};

export default function Toast({ toast, onDismiss }: ToastProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(toast.id), 300);
    }, 10000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className={`toast${exiting ? " toast-exit" : ""}`}>
      <span className="toast-message">{toast.message}</span>
      <div className="toast-actions">
        {toast.action && (
          <button className="toast-action-btn" onClick={toast.action.onClick}>
            {toast.action.label}
          </button>
        )}
        <button
          className="toast-close"
          onClick={() => {
            setExiting(true);
            setTimeout(() => onDismiss(toast.id), 300);
          }}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
