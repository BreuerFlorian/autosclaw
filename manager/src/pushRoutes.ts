import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.js";
import { getVapidPublicKey } from "./push.js";
import { savePushSubscription, getPushSubscriptions, deletePushSubscription } from "./db.js";

export function createPushRouter(): Router {
  const router = Router();

  // JWT auth middleware for all push routes
  router.use(requireAuth);

  // GET /api/push/vapid-public-key
  router.get("/vapid-public-key", (_req: Request, res: Response) => {
    res.json({ publicKey: getVapidPublicKey() });
  });

  // POST /api/push/subscribe
  router.post("/subscribe", (req: Request, res: Response) => {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ error: "Invalid subscription: endpoint and keys (p256dh, auth) required" });
      return;
    }
    savePushSubscription(req.user!.id, endpoint, keys.p256dh, keys.auth);
    res.json({ ok: true });
  });

  // DELETE /api/push/subscribe
  router.delete("/subscribe", (req: Request, res: Response) => {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ error: "endpoint required" });
      return;
    }
    deletePushSubscription(endpoint);
    res.json({ ok: true });
  });

  // GET /api/push/subscriptions
  router.get("/subscriptions", (req: Request, res: Response) => {
    const subs = getPushSubscriptions(req.user!.id);
    res.json({ subscriptions: subs.map((s) => ({ endpoint: s.endpoint, createdAt: s.created_at })) });
  });

  return router;
}
