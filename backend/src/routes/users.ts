import { Router } from "express";
import type { IRouter } from "express";
import { requireAuth, requireRole } from "../lib/session";

import { getUsers, getUserById, deleteUser } from "../services/users";

const router: IRouter = Router();

function handleServiceError(res: any, error: unknown) {
  if (error instanceof Error) {
    const message = error.message || "Internal server error";
    res.status(400).json({ error: message });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Internal server error" });
}

/**
 * GET /users
 * Get all users with optional filtering by role and/or name search
 */
router.get("/users", requireAuth, async (req, res): Promise<void> => {
  try {
    const { role, search } = req.query as { role?: string; search?: string };
    const users = await getUsers({ role, search });
    res.json(users);
  } catch (error) {
    handleServiceError(res, error);
  }
});

/**
 * GET /users/:id
 * Get a specific user by ID
 */
router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const user = await getUserById(id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  } catch (error) {
    handleServiceError(res, error);
  }
});

/**
 * DELETE /users/:id
 * Delete a supervisor user and unassign their teams (coordinator only)
 */
router.delete("/users/:id", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    await deleteUser(id, req.user!.id);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    handleServiceError(res, error);
  }
});
export default router;

