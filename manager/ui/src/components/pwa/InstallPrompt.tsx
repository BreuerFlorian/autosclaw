import { useState, useEffect } from "react";
import "./InstallPrompt.css";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("autosclaw_install_dismissed") === "true"
  );

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("autosclaw_install_dismissed", "true");
  };

  return (
    <div className="install-prompt">
      <span className="install-prompt-text">
        Install Autosclaw for quick access and push notifications
      </span>
      <div className="install-prompt-actions">
        <button className="install-prompt-btn" onClick={handleInstall}>Install</button>
        <button className="install-prompt-dismiss" onClick={handleDismiss}>&times;</button>
      </div>
    </div>
  );
}
