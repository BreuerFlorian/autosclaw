import WebSocket from "ws";

// ─── Token usage state ──────────────────────────────────────────────────────

export type TokenStats = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
};

// ─── ManagerClient class (WebSocket client → manager) ──────────────────────────

export type SpawnAgentParams = {
  name: string;
  purpose: string;
  systemPrompt: string;
};

export class ManagerClient {
  private ws: WebSocket | null = null;
  private submitCallback: ((message: string) => void) | null = null;
  private managerUrl: string;
  private agentId: string;
  private agentToken: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private spawnCallback: { resolve: (result: { agentId: string; name: string }) => void; reject: (err: Error) => void } | null = null;
  private spawnTimer: ReturnType<typeof setTimeout> | null = null;
  private askUserCallback: { resolve: (answers: Record<string, string>) => void; reject: (err: Error) => void } | null = null;
  private askUserTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(managerUrl: string, agentId: string, agentToken: string) {
    this.managerUrl = managerUrl;
    this.agentId = agentId;
    this.agentToken = agentToken;
    this.connect();
  }

  private connect(): void {
    console.log(`Connecting to manager: ${this.managerUrl}`);
    this.ws = new WebSocket(this.managerUrl);

    this.ws.on("open", () => {
      console.log("Connected to manager");
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      // Register with the manager
      this.send({ type: "register", agentId: this.agentId, token: this.agentToken });
    });

    this.ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ask_user_response" && msg.answers && typeof msg.answers === "object") {
          const cb = this.askUserCallback;
          this.askUserCallback = null;
          if (this.askUserTimer) { clearTimeout(this.askUserTimer); this.askUserTimer = null; }
          cb?.resolve(msg.answers as Record<string, string>);
        } else if (msg.type === "chat" && typeof msg.message === "string") {
          this.submitCallback?.(msg.message);
        } else if (msg.type === "close") {
          console.log("Received close command from manager, shutting down…");
          process.exit(0);
        } else if (msg.type === "agent_spawned" && typeof msg.agentId === "string") {
          const cb = this.spawnCallback;
          this.spawnCallback = null;
          if (this.spawnTimer) { clearTimeout(this.spawnTimer); this.spawnTimer = null; }
          cb?.resolve({ agentId: msg.agentId, name: msg.name ?? "" });
        }
      } catch {
        // ignore malformed messages
      }
    });

    this.ws.on("close", () => {
      console.log("Disconnected from manager, reconnecting in 2s…");
      this.ws = null;
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    });

    this.ws.on("error", (err: Error) => {
      console.error("WebSocket error:", err.message);
      // close handler will trigger reconnect
    });
  }

  // ── Public API (same interface as before) ─────────────────────────────────

  onSubmit(callback: (message: string) => void): void {
    this.submitCallback = callback;
  }

  appendOutput(type: string, content: string): void {
    if (!content) return;
    this.send({ type: "output", agentId: this.agentId, msgType: type, content });
  }

  updateTokens(stats: Partial<TokenStats>): void {
    this.send({ type: "tokens", agentId: this.agentId, tokens: stats });
  }

  setStatus(status: string): void {
    this.send({ type: "status", agentId: this.agentId, status });
  }

  setAgentStatus(targetAgentId: string, status: string): void {
    this.send({ type: "agent_status", agentId: targetAgentId, status });
  }

  appendToolUse(toolType: string, name: string, input: unknown): void {
    this.send({ type: "tool_use", agentId: this.agentId, toolType, name, input });
  }

  waitForAskUser(questions: unknown[]): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      // Reject any pending callback before overwriting
      if (this.askUserCallback) {
        this.askUserCallback.reject(new Error("waitForAskUser superseded by a new call"));
      }
      const cb = { resolve, reject };
      this.askUserCallback = cb;
      if (this.askUserTimer) clearTimeout(this.askUserTimer);
      this.send({ type: "ask_user", agentId: this.agentId, questions });
      // Timeout after 30 minutes — user may take a while, but don't hang forever
      this.askUserTimer = setTimeout(() => {
        if (this.askUserCallback === cb) {
          this.askUserCallback = null;
          this.askUserTimer = null;
          reject(new Error("waitForAskUser timed out after 30 minutes"));
        }
      }, 30 * 60_000);
    });
  }

  spawnAgent(params: SpawnAgentParams): Promise<{ agentId: string; name: string }> {
    return new Promise((resolve, reject) => {
      // Reject any pending callback before overwriting
      if (this.spawnCallback) {
        this.spawnCallback.reject(new Error("spawnAgent superseded by a new call"));
      }
      const cb = { resolve, reject };
      this.spawnCallback = cb;
      if (this.spawnTimer) clearTimeout(this.spawnTimer);
      this.send({
        type: "spawn_agent",
        agentId: this.agentId,
        name: params.name,
        purpose: params.purpose,
        systemPrompt: params.systemPrompt,
      });
      // Timeout after 60s — container startup can be slow
      this.spawnTimer = setTimeout(() => {
        if (this.spawnCallback === cb) {
          this.spawnCallback = null;
          this.spawnTimer = null;
          reject(new Error("Spawn agent timed out"));
        }
      }, 60_000);
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
