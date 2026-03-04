import webpush from "web-push";
import { getConfigValue, setConfigValue, getAllPushSubscriptions, deletePushSubscription, type PushSubscriptionRow } from "./db.js";

// ─── VAPID key management ────────────────────────────────────────────────────

let vapidConfigured = false;

function ensureVapidKeys(): { publicKey: string; privateKey: string } {
  let publicKey = getConfigValue("vapid_public_key");
  let privateKey = getConfigValue("vapid_private_key");

  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    setConfigValue("vapid_public_key", publicKey);
    setConfigValue("vapid_private_key", privateKey);
    console.log("Generated new VAPID keys");
  }

  if (!vapidConfigured) {
    webpush.setVapidDetails("mailto:admin@autosclaw.local", publicKey, privateKey);
    vapidConfigured = true;
  }

  return { publicKey, privateKey };
}

export function getVapidPublicKey(): string {
  return ensureVapidKeys().publicKey;
}

// ─── Push notification sending ───────────────────────────────────────────────

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
};

export async function sendPushToAll(payload: PushPayload): Promise<void> {
  ensureVapidKeys();
  const subscriptions = getAllPushSubscriptions();
  if (subscriptions.length === 0) return;

  const payloadStr = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subscriptions.map((sub: PushSubscriptionRow) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
        },
        payloadStr,
      ).catch((err: unknown) => {
        // Remove expired/invalid subscriptions (410 Gone, 404 Not Found)
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          deletePushSubscription(sub.endpoint);
        }
        throw err;
      })
    )
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.log(`Push: sent to ${subscriptions.length - failed}/${subscriptions.length} subscribers (${failed} failed)`);
  }
}

// ─── Event notification helpers ──────────────────────────────────────────────

export function notifyAgentCompleted(agentName: string, agentId: string): void {
  sendPushToAll({
    title: "Agent Completed",
    body: `Agent '${agentName}' has finished its work`,
    tag: `agent-completed-${agentId}`,
    data: { url: "/", agentId },
  }).catch(() => {});
}

export function notifyAgentError(agentName: string, agentId: string): void {
  sendPushToAll({
    title: "Agent Error",
    body: `Agent '${agentName}' encountered an error`,
    tag: `agent-error-${agentId}`,
    data: { url: "/", agentId },
  }).catch(() => {});
}

export function notifyAgentAskUser(agentName: string, agentId: string): void {
  sendPushToAll({
    title: "Input Needed",
    body: `Agent '${agentName}' is waiting for your input`,
    tag: `agent-ask-${agentId}`,
    data: { url: "/", agentId },
    actions: [{ action: "view", title: "View" }],
  }).catch(() => {});
}

export function notifyScheduleTriggered(scheduleName: string, agentName: string): void {
  sendPushToAll({
    title: "Schedule Triggered",
    body: `Schedule '${scheduleName}' spawned agent '${agentName}'`,
    tag: `schedule-${scheduleName}`,
    data: { url: "/" },
  }).catch(() => {});
}
