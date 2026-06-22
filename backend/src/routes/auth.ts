import { Router } from "express";
import type { IRouter } from "express";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/session";
import {
  registerUser,
  loginUser,
  getUserById,
  updateOfficeHours,
  formatUser,
} from "../services/auth";

const router: IRouter = Router();

/**
 * POST /auth/register
 * Register a new user (student, supervisor, or coordinator)
 */
router.post("/auth/register", async (req, res): Promise<void> => {
  try {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const result = await registerUser(parsed.data);
    res.status(201).json(result);
  } catch (error: any) {
    const statusCode = error.message?.includes("already registered") ? 409 : 400;
    res.status(statusCode).json({ error: error.message || "Registration failed" });
  }
});

/**
 * POST /auth/login
 * Authenticate user and start session
 */
router.post("/auth/login", async (req, res): Promise<void> => {
  try {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { email, password } = parsed.data;

    const result = await loginUser(email, password);
    req.session.userId = result.userId;

    res.json({
      user: result.user,
      message: result.message,
    });
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Login failed" });
  }
});

/**
 * POST /auth/logout
 * Destroy session and logout user
 */
router.post("/auth/logout", async (req, res): Promise<void> => {
  req.session.destroy(() => {
    res.json({ message: "Logged out" });
  });
});

/**
 * GET /auth/me
 * Get current authenticated user information
 */
router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  try {
    const user = await getUserById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch user" });
  }
});

/**
 * PUT /auth/me
 * Update supervisor office hours
 */
router.put("/auth/me", requireAuth, async (req, res): Promise<void> => {
  try {
    if (req.user!.role !== "supervisor") {
      res.status(403).json({ error: "Only supervisors can update office hours" });
      return;
    }

    const { officeHours } = req.body as { officeHours?: string | null };
    let normalizedOfficeHours: string | null = null;

    if (typeof officeHours === "string") {
      const lines = officeHours.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      const invalidLines = lines.filter((value) => Number.isNaN(new Date(value).getTime()));
      if (invalidLines.length > 0) {
        res.status(400).json({ error: "Office hours must contain valid date-time values" });
        return;
      }
      normalizedOfficeHours = lines.map((value) => new Date(value).toISOString()).join("\n");
    }

    const updated = await updateOfficeHours(req.user!.id, normalizedOfficeHours);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update office hours" });
  }
});

export default router;

