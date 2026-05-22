import { Router } from "express";
import type { IRouter } from "express";
import { db, usersTable, teamsTable } from "@workspace/db";
import { eq, ilike, and } from "@workspace/db";
import { requireAuth, requireRole } from "../lib/session";
import { logActivity } from "../lib/notify";

const router: IRouter = Router();

router.get("/users", requireAuth, async (req, res): Promise<void> => {
  const { role, search } = req.query as { role?: string; search?: string };

  let query = db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    createdAt: usersTable.createdAt,
  }).from(usersTable);

  const conditions = [];
  if (role) conditions.push(eq(usersTable.role, role as "student" | "supervisor" | "coordinator"));
  if (search) conditions.push(ilike(usersTable.name, `%${search}%`));

  const users = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query;

  res.json(users);
});

router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [user] = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.id, id));

  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(user);
});

router.delete("/users/:id", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [supervisor] = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    role: usersTable.role,
  }).from(usersTable).where(eq(usersTable.id, id));

  if (!supervisor) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (supervisor.role !== "supervisor") {
    res.status(400).json({ error: "Only supervisor accounts can be deleted through this endpoint." });
    return;
  }

  await db.update(teamsTable)
    .set({ supervisorId: null, status: "active" })
    .where(eq(teamsTable.supervisorId, id));

  await db.delete(usersTable).where(eq(usersTable.id, id));

  await logActivity(
    "supervisor_deleted",
    `Coordinator deleted supervisor ${supervisor.name} from the system and unassigned any managed teams.`,
    req.user!.id,
    null
  );

  res.json({ message: "Supervisor deleted successfully" });
});

export default router;

