import { Router } from "express";
import type { IRouter } from "express";
import { db, teamsTable, tasksTable, teamMembersTable } from "@workspace/db";
import { eq, and } from "@workspace/db";
import { requireAuth, requireRole } from "../lib/session";
import { createNotification, logActivity } from "../lib/notify";

const router: IRouter = Router();

function isTaskVisibleForSupervisor(task: typeof tasksTable.$inferSelect, supervisorId: number | null | undefined) {
  if (!supervisorId) return false;
  return task.supervisorId == null || task.supervisorId === supervisorId;
}

async function formatTask(task: typeof tasksTable.$inferSelect) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
  return { ...task, team };
}

router.get("/tasks", requireAuth, async (req, res): Promise<void> => {
  let tasks: (typeof tasksTable.$inferSelect)[];

  if (req.user!.role === "student") {
    const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
    if (!membership) { res.json([]); return; }
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
    if (!team || !team.supervisorId) { res.json([]); return; }
    tasks = await db.select().from(tasksTable).where(eq(tasksTable.teamId, membership.teamId));
    tasks = tasks.filter((task) => isTaskVisibleForSupervisor(task, team.supervisorId));
  } else if (req.user!.role === "supervisor") {
    const supervisedTeams = await db.select().from(teamsTable).where(eq(teamsTable.supervisorId, req.user!.id));
    const teamIds = supervisedTeams.map(t => t.id);
    if (teamIds.length === 0) { res.json([]); return; }
    tasks = await db.select().from(tasksTable);
    tasks = tasks.filter(t => teamIds.includes(t.teamId) && isTaskVisibleForSupervisor(t, req.user!.id));
  } else {
    tasks = await db.select().from(tasksTable);
  }

  const formatted = await Promise.all(tasks.map(formatTask));
  res.json(formatted);
});

router.post("/tasks", requireAuth, requireRole("supervisor", "coordinator"), async (req, res): Promise<void> => {
  const { teamId, title, description, deadline, phase } = req.body;
  if (!teamId || !title || !phase) { res.status(400).json({ error: "teamId, title, and phase required" }); return; }

  if (req.user!.role === "supervisor") {
    const assignedTeams = await db.select().from(teamsTable).where(eq(teamsTable.supervisorId, req.user!.id));
    if (assignedTeams.length === 0) {
      res.status(403).json({ error: "You are not assigned to any team, so you cannot create tasks" });
      return;
    }
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  if (!team.supervisorId) { res.status(400).json({ error: "Cannot create tasks for a team without a supervisor" }); return; }
  if (req.user!.role === "supervisor" && team.supervisorId !== req.user!.id) {
    res.status(403).json({ error: "You can only create tasks for teams assigned to you" });
    return;
  }

  const [task] = await db.insert(tasksTable).values({
    teamId,
    supervisorId: team.supervisorId,
    title,
    description,
    deadline: deadline ? new Date(deadline) : null,
    phase,
    status: "pending",
  }).returning();

  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  for (const m of members) {
    await createNotification(m.userId, "new_task", `New task "${title}" has been assigned to your team`);
  }
  await logActivity("task_created", `Task "${title}" created for team "${team.name}"`, req.user!.id, teamId);

  res.status(201).json(await formatTask(task));
});

router.get("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  if (req.user!.role === "student") {
    const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
    if (!membership || membership.teamId !== task.teamId) { res.status(404).json({ error: "Task not found" }); return; }
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
    if (!team || !team.supervisorId) { res.status(403).json({ error: "Your team no longer has a supervisor, so this task is unavailable" }); return; }
    if (!isTaskVisibleForSupervisor(task, team.supervisorId)) {
      res.status(403).json({ error: "This task belongs to a previous supervisor assignment and is currently unavailable" });
      return;
    }
  }

  if (req.user!.role === "supervisor") {
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
    if (!team || team.supervisorId !== req.user!.id || !isTaskVisibleForSupervisor(task, req.user!.id)) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
  }

  res.json(await formatTask(task));
});

router.put("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const { title, description, deadline, status } = req.body;
  const [updated] = await db.update(tasksTable).set({ title, description, deadline: deadline ? new Date(deadline) : task.deadline, status }).where(eq(tasksTable.id, id)).returning();
  res.json(await formatTask(updated));
});

export default router;

