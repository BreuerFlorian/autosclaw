import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { env } from "./env.js";
import { getUserByUsername, getUserById, createUser, verifyPassword, listUsers, updateUserRole, type UserRole } from "./db.js";
import { logger } from "./logger.js";

// ─── JWT config ──────────────────────────────────────────────────────────────

const JWT_SECRET = env.JWT_SECRET || (() => {
  const secret = randomBytes(32).toString("hex");
  logger.warn("JWT_SECRET not set — using ephemeral secret (tokens will not survive restarts)");
  return secret;
})();

const TOKEN_EXPIRY = "24h";

export type AuthPayload = {
  sub: number;
  username: string;
  role: UserRole;
};

/** User info attached to req.user by requireAuth middleware. */
export type AuthUser = {
  id: number;
  username: string;
  role: UserRole;
};

// Extend Express Request to include user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: number, username: string, role: UserRole): string {
  return jwt.sign({ sub: userId, username, role } satisfies AuthPayload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === "string") return null;
    return decoded as unknown as AuthPayload;
  } catch {
    return null;
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/** Middleware that requires a valid JWT and attaches the user to req.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token" });
    return;
  }
  const payload = verifyToken(authHeader.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  req.user = { id: payload.sub, username: payload.username, role: payload.role };
  next();
}

/** Middleware factory that checks if the user has one of the allowed roles. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

// ─── Auth router ─────────────────────────────────────────────────────────────

export const authRouter = Router();

// POST /auth/login
authRouter.post("/auth/login", (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  const user = getUserByUsername(username);
  if (!user || !verifyPassword(user, password)) {
    logger.warn("Login failed", { username, ip: req.ip });
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = signToken(user.id, user.username, user.role);
  logger.info("Login successful", { username, ip: req.ip });
  res.json({ token, username: user.username, role: user.role });
});

// POST /auth/register
authRouter.post("/auth/register", (req: Request, res: Response) => {
  if (!env.ALLOW_REGISTRATION) {
    res.status(403).json({ error: "Registration is disabled" });
    return;
  }
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  if (username.length < 3 || password.length < 6) {
    res.status(400).json({ error: "Username must be >= 3 chars, password >= 6 chars" });
    return;
  }
  if (getUserByUsername(username)) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }
  const user = createUser(username, password, "member");
  const token = signToken(user.id, user.username, user.role);
  logger.info("User registered", { username, ip: req.ip });
  res.status(201).json({ token, username: user.username, role: user.role });
});

// GET /auth/me
authRouter.get("/auth/me", (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token" });
    return;
  }
  const payload = verifyToken(authHeader.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  res.json({ username: payload.username, role: payload.role });
});

// GET /auth/users — admin only: list all users
authRouter.get("/auth/users", requireAuth, requireRole("admin"), (_req: Request, res: Response) => {
  const users = listUsers();
  res.json({ users });
});

// PUT /auth/users/:id/role — admin only: update user role
authRouter.put("/auth/users/:id/role", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }
  const { role } = req.body;
  if (!role || !["admin", "member", "viewer"].includes(role)) {
    res.status(400).json({ error: "Invalid role. Must be admin, member, or viewer" });
    return;
  }
  const user = getUserById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  updateUserRole(userId, role as UserRole);
  logger.info("User role updated", { targetUserId: userId, targetUsername: user.username, newRole: role, updatedBy: req.user!.username });
  res.json({ id: userId, username: user.username, role });
});
