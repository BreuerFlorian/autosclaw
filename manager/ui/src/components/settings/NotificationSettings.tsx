import { useState } from "react";
import { usePushNotifications } from "../../hooks/usePushNotifications";
import "./NotificationSettings.css";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function NotificationSettings({ open, onClose }: Props) {
  const { isSupported, isSubscribed, permission, subscribe, unsubscribe } = usePushNotifications();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleToggle = async () => {
    setLoading(true);
    setError(null);
    try {
      if (isSubscribed) {
        await unsubscribe();
      } else {
        await subscribe();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update notifications");
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div className="modal-card settings-card">
        <h3>Notification Settings</h3>

        {!isSupported ? (
          <p className="settings-note">
            Push notifications are not supported in this browser.
          </p>
        ) : (
          <>
            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-label-text">Push Notifications</span>
                <span className="settings-label-desc">
                  Get alerted when agents need your attention
                </span>
              </div>
              <button
                className={`toggle-btn${isSubscribed ? " active" : ""}`}
                onClick={handleToggle}
                disabled={loading || permission === "denied"}
              >
                <span className="toggle-knob" />
              </button>
            </div>

            <div className="settings-status">
              <span className="settings-status-label">Permission:</span>
              <span className={`settings-status-value ${permission}`}>
                {permission === "granted" ? "Allowed" : permission === "denied" ? "Blocked" : "Not set"}
              </span>
            </div>

            {permission === "denied" && (
              <p className="settings-note settings-warning">
                Notifications are blocked. Please enable them in your browser settings.
              </p>
            )}

            {error && <p className="settings-note settings-warning">{error}</p>}
          </>
        )}

        <div className="modal-actions">
          <button className="modal-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
