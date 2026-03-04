import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";
import { execFileSync } from "node:child_process";

const envPath = process.env.ENV_FILE || join(fileURLToPath(import.meta.url), "..", "..", "..", ".env");

function parseEnvFile(path: string): Record<string, string> {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    process.stderr.write(JSON.stringify({ level: "warn", msg: "Could not read env file", path, timestamp: new Date().toISOString() }) + "\n");
    return {};
  }
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

const vars = parseEnvFile(envPath);

function detectDockerHost(): string {
  // macOS/Windows: host.docker.internal works out of the box
  if (platform() !== "linux") return "host.docker.internal";
  // Linux: try to get the docker bridge gateway IP
  try {
    const out = execFileSync("docker", ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (out) return out;
  } catch { /* fall through */ }
  // Fallback: default Docker bridge gateway
  return "172.17.0.1";
}

const dataDir = join(fileURLToPath(import.meta.url), "..", "..", "data");

export const env = {
  PORT: Number(vars.PORT) || 4000,
  ENV_FILE: envPath,
  MANAGER_HOST: vars.MANAGER_HOST || detectDockerHost(),
  JWT_SECRET: vars.JWT_SECRET || "",
  ALLOW_REGISTRATION: vars.ALLOW_REGISTRATION === "true",
  ADMIN_USERNAME: vars.ADMIN_USERNAME || "",
  ADMIN_PASSWORD: vars.ADMIN_PASSWORD || "",
  LOG_LEVEL: vars.LOG_LEVEL || "info",
  LOG_DIR: vars.LOG_DIR || join(dataDir, "logs"),
};
