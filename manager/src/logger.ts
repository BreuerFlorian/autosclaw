import { statSync, renameSync, mkdirSync, appendFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env.js";

// ─── Log levels ─────────────────────────────────────────────────────────────

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = (value || "info").toLowerCase();
  if (normalized in LOG_LEVELS) return normalized as LogLevel;
  return "info";
}

const currentLevel = parseLogLevel(env.LOG_LEVEL);

// ─── File rotation ──────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;
const logDir = env.LOG_DIR;
const logFile = join(logDir, "autosclaw.log");

mkdirSync(logDir, { recursive: true });

function rotateIfNeeded(): void {
  let size: number;
  try {
    size = statSync(logFile).size;
  } catch {
    return; // file doesn't exist yet
  }
  if (size < MAX_FILE_SIZE) return;

  // Delete the oldest rotated file if it exists
  try {
    unlinkSync(join(logDir, `autosclaw.log.${MAX_FILES}`));
  } catch {
    // file doesn't exist, skip
  }
  // Rotate: .4 -> .5, .3 -> .4, ... .1 -> .2, current -> .1
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    try {
      renameSync(join(logDir, `autosclaw.log.${i}`), join(logDir, `autosclaw.log.${i + 1}`));
    } catch {
      // file doesn't exist, skip
    }
  }
  try {
    renameSync(logFile, join(logDir, "autosclaw.log.1"));
  } catch {
    // best effort
  }
}

// ─── Logger implementation ──────────────────────────────────────────────────

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}

function createLogger(baseCtx: Record<string, unknown> = {}): Logger {
  function log(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

    const entry: Record<string, unknown> = {
      level,
      msg,
      timestamp: new Date().toISOString(),
      ...baseCtx,
      ...ctx,
    };

    const line = JSON.stringify(entry);

    // Write to stdout/stderr
    if (level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }

    // Write to file
    try {
      rotateIfNeeded();
      appendFileSync(logFile, line + "\n");
    } catch {
      // Don't crash if log file write fails
    }
  }

  return {
    debug(msg: string, ctx?: Record<string, unknown>) { log("debug", msg, ctx); },
    info(msg: string, ctx?: Record<string, unknown>) { log("info", msg, ctx); },
    warn(msg: string, ctx?: Record<string, unknown>) { log("warn", msg, ctx); },
    error(msg: string, ctx?: Record<string, unknown>) { log("error", msg, ctx); },
    child(ctx: Record<string, unknown>): Logger {
      return createLogger({ ...baseCtx, ...ctx });
    },
  };
}

export const logger = createLogger();
