import { Router } from "express";
import type { IRouter } from "express";
import { db, usersTable, tasksTable, teamsTable, submissionsTable, teamMembersTable } from "@workspace/db";
import { eq, and, or } from "@workspace/db";
import { requireAuth } from "../lib/session";
import { createNotification, logActivity } from "../lib/notify";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";

const router: IRouter = Router();

function isTaskVisibleForSupervisor(task: typeof tasksTable.$inferSelect, supervisorId: number | null | undefined) {
  if (!supervisorId) return false;
  return task.supervisorId == null || task.supervisorId === supervisorId;
}

function safeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base || "submission.pdf";
}

function getUploadDir(): string {
  return path.resolve(process.cwd(), "uploads", "submissions");
}

async function formatSubmissions(subs: (typeof submissionsTable.$inferSelect)[]) {
  if (subs.length === 0) return [];
  
  // Collect unique IDs we need to fetch
  const taskIds = [...new Set(subs.map(s => s.taskId))];
  const userIds = [...new Set(subs.map(s => s.submittedById))];
  
  // Fetch only matching tasks instead of scanning the full table.
  const tasks = taskIds.length === 1
    ? await db.select().from(tasksTable).where(eq(tasksTable.id, taskIds[0]))
    : await db.select().from(tasksTable).where(or(...taskIds.map((id) => eq(tasksTable.id, id))));
  const tasksMap = new Map(tasks.map(t => [t.id, t]));
  
  const teamIds = [...new Set(tasks.map(t => t.teamId))];
  const teams = teamIds.length === 0
    ? []
    : teamIds.length === 1
      ? await db.select().from(teamsTable).where(eq(teamsTable.id, teamIds[0]))
      : await db.select().from(teamsTable).where(or(...teamIds.map((id) => eq(teamsTable.id, id))));
  const teamsMap = new Map(teams.map(t => [t.id, t]));
  
  const users = userIds.length === 1
    ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, userIds[0]))
    : await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(or(...userIds.map((id) => eq(usersTable.id, id))));
  const usersMap = new Map(users.map(u => [u.id, u]));
  
  // Format submissions using pre-fetched data (replaces N+1 queries with 3 batch queries)
  return subs.map(sub => {
    const task = tasksMap.get(sub.taskId);
    const team = task ? teamsMap.get(task.teamId) : undefined;
    const submittedBy = usersMap.get(sub.submittedById);
    return { ...sub, task: task ? { ...task, team } : undefined, submittedBy };
  });
}

router.get("/submissions", requireAuth, async (req, res): Promise<void> => {
  const taskIdRaw = req.query.taskId ? parseInt(String(req.query.taskId), 10) : null;
  const taskIdParam = taskIdRaw != null && !Number.isNaN(taskIdRaw) ? taskIdRaw : null;
  
  let subs: (typeof submissionsTable.$inferSelect)[];
  if (req.user!.role === "student") {
    const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
    if (!membership) { res.json([]); return; }
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
    if (!team || !team.supervisorId) { res.json([]); return; }

    const tasks = (await db.select().from(tasksTable).where(eq(tasksTable.teamId, membership.teamId)))
      .filter((task) => isTaskVisibleForSupervisor(task, team.supervisorId));
    const taskIds = tasks.map(t => t.id);
    if (taskIds.length === 0) { res.json([]); return; }
    
    if (taskIdParam && taskIds.includes(taskIdParam)) {
      // Fetch only submissions for specific task if taskId provided
      subs = await db.select().from(submissionsTable).where(eq(submissionsTable.taskId, taskIdParam));
    } else if (taskIdParam) {
      // taskId not in user's team tasks
      res.json([]); return;
    } else {
      // Fetch only submissions for tasks in student's team.
      subs = taskIds.length === 1
        ? await db.select().from(submissionsTable).where(eq(submissionsTable.taskId, taskIds[0]))
        : await db.select().from(submissionsTable).where(or(...taskIds.map((id) => eq(submissionsTable.taskId, id))));
    }
  } else if (req.user!.role === "supervisor") {
    // Supervisors see submissions filtered by taskId if provided
    if (taskIdParam) {
      subs = await db.select().from(submissionsTable).where(eq(submissionsTable.taskId, taskIdParam));
    } else {
      subs = await db.select().from(submissionsTable);
    }
  } else {
    // Coordinators see all submissions
    if (taskIdParam) {
      subs = await db.select().from(submissionsTable).where(eq(submissionsTable.taskId, taskIdParam));
    } else {
      subs = await db.select().from(submissionsTable);
    }
  }
  const formatted = await formatSubmissions(subs);
  res.json(formatted);
});

router.post("/submissions/upload", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(String(req.query.taskId || ""), 10);
  if (Number.isNaN(taskId) || taskId <= 0) {
    res.status(400).json({ error: "taskId is required" });
    return;
  }

  const notes = typeof req.query.notes === "string" ? req.query.notes : "";
  const originalName = typeof req.query.filename === "string" ? req.query.filename : "submission.pdf";
  const contentType = typeof req.query.contentType === "string" ? req.query.contentType : req.headers["content-type"];

  if (contentType && !String(contentType).includes("pdf")) {
    res.status(400).json({ error: "Only PDF files are supported" });
    return;
  }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (req.user!.role === "student") {
    const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
    if (!membership || membership.teamId !== task.teamId) {
      res.status(403).json({ error: "You are not allowed to submit this task" });
      return;
    }

    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
    if (!team || !team.supervisorId) {
      res.status(403).json({ error: "Your team no longer has a supervisor, so task submission is disabled" });
      return;
    }
    if (!isTaskVisibleForSupervisor(task, team.supervisorId)) {
      res.status(403).json({ error: "This task belongs to a previous supervisor assignment and cannot be submitted now" });
      return;
    }
  }

  mkdirSync(getUploadDir(), { recursive: true });

  const storedName = `${randomUUID()}-${safeFileName(originalName)}`;
  const storedPath = path.join(getUploadDir(), storedName);

  await pipeline(req, createWriteStream(storedPath));

  const fileUrl = `/uploads/submissions/${storedName}`;

  const [sub] = await db.insert(submissionsTable).values({
    taskId,
    submittedById: req.user!.id,
    fileUrl,
    notes,
    status: "pending",
  }).returning();

  await db.update(tasksTable).set({ status: "submitted" }).where(eq(tasksTable.id, taskId));

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
  if (team?.supervisorId) {
    await createNotification(team.supervisorId, "new_submission", `Team "${team.name}" submitted deliverable for task "${task.title}"`);
  }
  await logActivity("submission_created", `Submitted deliverable for task "${task.title}"`, req.user!.id, task.teamId);

  res.status(201).json((await formatSubmissions([sub]))[0]);
});

router.post("/submissions", requireAuth, async (req, res): Promise<void> => {
  const { taskId, fileUrl, notes } = req.body;
  if (!taskId) { res.status(400).json({ error: "taskId required" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  if (req.user!.role === "student") {
    const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
    if (!membership || membership.teamId !== task.teamId) {
      res.status(403).json({ error: "You are not allowed to submit this task" });
      return;
    }

    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
    if (!team || !team.supervisorId) {
      res.status(403).json({ error: "Your team no longer has a supervisor, so task submission is disabled" });
      return;
    }
    if (!isTaskVisibleForSupervisor(task, team.supervisorId)) {
      res.status(403).json({ error: "This task belongs to a previous supervisor assignment and cannot be submitted now" });
      return;
    }
  }

  const [sub] = await db.insert(submissionsTable).values({ taskId, submittedById: req.user!.id, fileUrl, notes, status: "pending" }).returning();
  await db.update(tasksTable).set({ status: "submitted" }).where(eq(tasksTable.id, taskId));

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
  if (team?.supervisorId) {
    await createNotification(team.supervisorId, "new_submission", `Team "${team.name}" submitted deliverable for task "${task.title}"`);
  }
  await logActivity("submission_created", `Submitted deliverable for task "${task.title}"`, req.user!.id, task.teamId);

  res.status(201).json((await formatSubmissions([sub]))[0]);
});

router.post("/submissions/:id/review", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [sub] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, id));
  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }

  const { status, feedback } = req.body;
  if (!status || !["approved", "rejected"].includes(status)) { res.status(400).json({ error: "Valid status required" }); return; }

  const [updated] = await db.update(submissionsTable).set({ status, feedback }).where(eq(submissionsTable.id, id)).returning();
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, sub.taskId));
  if (status === "approved") {
    await db.update(tasksTable).set({ status: "reviewed" }).where(eq(tasksTable.id, sub.taskId));
  }

  await createNotification(sub.submittedById, "submission_reviewed", `Your submission for "${task?.title}" has been ${status}`);
  await logActivity("submission_reviewed", `Submission for "${task?.title}" marked as ${status}`, req.user!.id, task?.teamId);

  res.json((await formatSubmissions([updated]))[0]);
});

export default router;

