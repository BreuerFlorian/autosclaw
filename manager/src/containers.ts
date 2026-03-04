import { spawn, execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import { logger } from "./logger.js";

export type AgentContainer = {
  id: string;
  name: string;
  containerName: string;
  token: string;
  status: "starting" | "running" | "stopped";
  process: ChildProcess | null;
};

const CONTAINER_PREFIX = "autosclaw-agent-";

/** Active child processes keyed by agent ID. */
const processes = new Map<string, ChildProcess>();

function generateId(): string {
  return randomUUID();
}

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} ${args.join(" ")} failed: ${stderr || err.message}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

const AGENT_IMAGE = "autosclaw-agent";

/**
 * Build the agent Docker image from ../agent/Dockerfile.
 */
export function buildAgentImage(agentDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info("Building agent image", { image: AGENT_IMAGE, agentDir });
    const child = spawn("docker", ["build", "-t", AGENT_IMAGE, agentDir], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("exit", (code) => {
      if (code === 0) {
        logger.info("Agent image built successfully", { image: AGENT_IMAGE });
        resolve();
      } else {
        reject(new Error(`docker build exited with code ${code}`));
      }
    });
    child.on("error", (err) => reject(err));
  });
}

/**
 * Start a new agent container. Pipes secrets + MANAGER_URL + AGENT_ID via stdin.
 * Runs in the foreground (no -d) so stdin is properly delivered, then the
 * docker process stays alive for the container's lifetime.
 */
export async function startAgent(
  name: string,
  envFile: string,
  managerUrl: string,
  onExit?: (id: string, code: number | null) => void,
  extraEnv?: string,
): Promise<AgentContainer> {
  const id = generateId();
  const containerName = `${CONTAINER_PREFIX}${id}`;
  const agentToken = randomBytes(32).toString("hex");

  // Read the .env file and append manager-specific vars
  const envPath = resolve(envFile);
  let envData: string;
  try {
    envData = readFileSync(envPath, "utf-8");
  } catch {
    throw new Error(`Cannot read env file: ${envPath}`);
  }
  envData += `\nMANAGER_URL=${managerUrl}\nAGENT_ID=${id}\nAGENT_TOKEN=${agentToken}\n`;
  if (extraEnv) {
    envData += extraEnv + "\n";
  }

  // Use a shell pipe so stdin is reliably delivered — matches how start.sh works.
  // The shell holds stdin open until the heredoc is fully consumed by docker.
  const child = spawn(
    "sh",
    ["-c", `cat <<'AUTOSCLAW_ENV_EOF' | docker run --rm -i --name "${containerName}" ${AGENT_IMAGE} sh -c "exec node --import tsx src/main.ts"\n${envData}AUTOSCLAW_ENV_EOF`],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  // Log stderr for debugging
  child.stderr!.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) logger.debug("Container stderr", { containerName, output: line });
  });

  child.on("exit", (code) => {
    processes.delete(id);
    onExit?.(id, code);
  });

  child.on("error", (err) => {
    logger.error("Container spawn error", { containerName, error: err.message });
    processes.delete(id);
    onExit?.(id, 1);
  });

  processes.set(id, child);

  return { id, name, containerName, token: agentToken, status: "starting", process: child };
}

/** Stop and remove an agent container with a 10s timeout. */
export async function stopAgent(agentId: string): Promise<void> {
  const containerName = `${CONTAINER_PREFIX}${agentId}`;

  // Kill the docker process if still tracked
  const child = processes.get(agentId);
  if (child) {
    child.kill();
    processes.delete(agentId);
  }

  try {
    // Give Docker 10s to stop gracefully, then force kill
    await exec("docker", ["stop", "-t", "10", containerName]);
  } catch {
    try {
      await exec("docker", ["kill", containerName]);
    } catch {
      // already dead
    }
  } finally {
    processes.delete(agentId);
  }
  try {
    await exec("docker", ["rm", containerName]);
  } catch {
    // already removed (--rm handles this in most cases)
  }
}

/** List all running autosclaw-agent containers. */
export async function listContainers(): Promise<Array<{ agentId: string; containerName: string; status: string }>> {
  try {
    const output = await exec("docker", [
      "ps",
      "-a",
      "--filter", `name=${CONTAINER_PREFIX}`,
      "--format", "{{.Names}}\t{{.Status}}",
    ]);
    if (!output) return [];
    return output.split("\n").map((line) => {
      const [containerName, ...statusParts] = line.split("\t");
      const agentId = containerName.replace(CONTAINER_PREFIX, "");
      return { agentId, containerName, status: statusParts.join("\t") };
    });
  } catch (err) {
    logger.error("Failed to list containers", { error: String(err) });
    return [];
  }
}
