import { useState, useEffect, useCallback, useMemo } from "react";
import type { UserRole } from "../types";

function decodeJwtPayload(token: string): { sub: number; username: string; role: UserRole } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return { sub: payload.sub, username: payload.username, role: payload.role || "member" };
  } catch {
    return null;
  }
}

export function useAuth() {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem("autosclaw_token")
  );
  const [validating, setValidating] = useState(!!localStorage.getItem("autosclaw_token"));

  const decoded = useMemo(() => (token ? decodeJwtPayload(token) : null), [token]);
  const role: UserRole = decoded?.role ?? "member";
  const userId: number | null = decoded?.sub ?? null;

  useEffect(() => {
    if (!token) { setValidating(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/auth/me", {
          headers: { Authorization: "Bearer " + token },
        });
        if (!res.ok && !cancelled) {
          localStorage.removeItem("autosclaw_token");
          setToken(null);
        }
      } catch {
        if (!cancelled) {
          localStorage.removeItem("autosclaw_token");
          setToken(null);
        }
      } finally {
        if (!cancelled) setValidating(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (username: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || "Login failed" };
      localStorage.setItem("autosclaw_token", data.token);
      setToken(data.token);
      return { ok: true };
    } catch {
      return { ok: false, error: "Connection error" };
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("autosclaw_token");
    setToken(null);
  }, []);

  const validateToken = useCallback(async (): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch("/auth/me", {
        headers: { Authorization: "Bearer " + token },
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [token]);

  return { token, login, logout, validating, validateToken, role, userId };
}
