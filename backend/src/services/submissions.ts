import { db, submissionsTable, tasksTable, teamsTable, usersTable, teamMembersTable } from "@workspace/db";
import { eq, and, or } from "@workspace/db";
import path from "node:path";
import { createNotification, logActivity } from "../lib/notify";

// ============ Utilities ============

/**
 * Get safe filename from upload
 */
export function safeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base || "submission.pdf";
}

/**
 * Get upload directory path
 */
export function getUploadDir(): string {
  return path.resolve(process.cwd(), "uploads", "submissions");
}

// ============ Visibility & Permissions ============

/**
 * Check if task is visible for supervisor
 */
function isTaskVisibleForSupervisor(task: typeof tasksTable.$inferSelect, supervisorId: number | null | undefined): boolean {
  if (!supervisorId) return false;
  return task.supervisorId == null || task.supervisorId === supervisorId;
}

// ============ Formatting ============

/**
 * Format submissions with related task, team, and user data (optimized for N+1 queries)
 */
export async function formatSubmissions(submissions: (typeof submissionsTable.$inferSelect)[]): Promise<any[]> {
  if (submissions.length === 0) return [];

  // Collect unique IDs
  const taskIds = [...new Set(submissions.map((s) => s.taskId))];
  const userIds = [...new Set(submissions.map((s) => s.submittedById))];

  // Batch fetch tasks
  const tasks =
    taskIds.length === 1
      ? await db.select().from(tasksTable).where(eq(tasksTable.id, taskIds[0]))
      : await db.select().from(tasksTable).where(or(...taskIds.map((id) => eq(tasksTable.id, id))));
  const tasksMap = new Map(tasks.map((t) => [t.id, t]));

  // Batch fetch teams
  const teamIds = [...new Set(tasks.map((t) => t.teamId))];
  const teams =
    teamIds.length === 0
      ? []
      : teamIds.length === 1
        ? await db.select().from(teamsTable).where(eq(teamsTable.id, teamIds[0]))
        : await db.select().from(teamsTable).where(or(...teamIds.map((id) => eq(teamsTable.id, id))));
  const teamsMap = new Map(teams.map((t) => [t.id, t]));

  // Batch fetch users
  const users =
    userIds.length === 1
      ? await db
          .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
          .from(usersTable)
          .where(eq(usersTable.id, userIds[0]))
      : await db
          .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
          .from(usersTable)
          .where(or(...userIds.map((id) => eq(usersTable.id, id))));
  const usersMap = new Map(users.map((u) => [u.id, u]));

  // Format with pre-fetched data
  return submissions.map((sub) => {
    const task = tasksMap.get(sub.taskId);
    const team = task ? teamsMap.get(task.teamId) : undefined;
    const submittedBy = usersMap.get(sub.submittedById);
    return { ...sub, task: task ? { ...task, team } : undefined, submittedBy };
  });
}

// ============ Queries ============

/**
 * Get submissions for student (by team tasks)
 */
export async function getStudentSubmissions(userId: number, taskId?: number): Promise<any[]> {
  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  if (!membership) {
    return [];
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
  if (!team || !team.supervisorId) {
    return [];
  }

  const tasks = (await db.select().from(tasksTable).where(eq(tasksTable.teamId, membership.teamId))).filter((task) => isTaskVisibleForSupervisor(task, team.supervisorId));

  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length === 0) {
    return [];
  }

  let submissions: (typeof submissionsTable.$inferSelect)[];

  if (taskId && taskIds.includes(taskId)) {
    submissions = await db.select().from(submissionsTable).where(eq(submissionsTable.taskId, taskId));
  } else if (taskId) {
    return [];
  } else {
    submissions = taskIds.length === 1 ? await db.select().from(submissionsTable).where(eq(submissionsTable.taskId, taskIds[0])) : await db.select().from(submissionsTable).where(or(...taskIds.map((id) => eq(submissionsTable.taskId, id))));
  }

  return formatSubmissions(submissions);
}

/**
 * Get submissions for supervisor
 */
export async function getSupervisorSubmissions(supervisorId: number, taskId?: number): Promise<any[]> {
  let submissions: (typeof submissionsTable.$inferSelect)[];

  if (taskId) {
    submissions = await db.select().from(submissionsTable).where(eq(submissionsTable.taskId, taskId));
  } else {
    submissions = await db.select().from(submissionsTable);
  }

  return formatSubmissions(submissions);
}

/**
 * Get all submissions (coordinator view)
 */
export async function getAllSubmissions(taskId?: number): Promise<any[]> {
  let submissions: (typeof submissionsTable.$inferSelect)[];

  if (taskId) {
    submissions = await db.select().from(submissionsTable).where(eq(submissionsTable.taskId, taskId));
  } else {
    submissions = await db.select().from(submissionsTable);
  }

  return formatSubmissions(submissions);
}

/**
 * Get submission by ID
 */
export async function getSubmissionById(submissionId: number): Promise<any | null> {
  const [submission] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, submissionId));

  if (!submission) {
    return null;
  }

  const formatted = await formatSubmissions([submission]);
  return formatted[0];
}

// ============ Submission Operations ============

/**
 * Create submission
 */
export async function createSubmission(taskId: number, userId: number, fileName: string, fileSize: number): Promise<any> {
  const [submission] = await db
    .insert(submissionsTable)
    .values({
      taskId,
      submittedById: userId,
      fileName: safeFileName(fileName),
      fileSize,
    })
    .returning();

  await logActivity("submission_created", `Submission for task ${taskId} created`, userId, null);

  const formatted = await formatSubmissions([submission]);
  return formatted[0];
}

/**
 * Update submission status (approve/reject)
 */
export async function updateSubmissionStatus(submissionId: number, status: "approved" | "rejected", supervisorId: number): Promise<any | null> {
  const [updated] = await db.update(submissionsTable).set({ status, reviewedBy: supervisorId, reviewedAt: new Date() }).where(eq(submissionsTable.id, submissionId)).returning();

  if (!updated) {
    return null;
  }

  const [submission] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, submissionId));
  if (submission) {
    await createNotification(submission.submittedById, "submission_reviewed", `Your submission has been ${status}`);
  }

  const formatted = await formatSubmissions([updated]);
  return formatted[0];
}

/**
 * Delete submission
 */
export async function deleteSubmission(submissionId: number): Promise<void> {
  await db.delete(submissionsTable).where(eq(submissionsTable.id, submissionId));
}

// ============ Permission & Validation ============

/**
 * Validate if user can submit for a task
 */
export async function validateStudentCanSubmit(taskId: number, userId: number): Promise<{ valid: boolean; error?: string }> {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    return { valid: false, error: "Task not found" };
  }

  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  if (!membership || membership.teamId !== task.teamId) {
    return { valid: false, error: "You are not allowed to submit this task" };
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
  if (!team || !team.supervisorId) {
    return { valid: false, error: "Your team no longer has a supervisor, so task submission is disabled" };
  }

  if (!isTaskVisibleForSupervisor(task, team.supervisorId)) {
    return { valid: false, error: "This task belongs to a previous supervisor assignment and cannot be submitted now" };
  }

  return { valid: true };
}

/**
 * Upload and create submission (handles file storage and DB insert)
 */
export async function uploadSubmission(
  taskId: number,
  userId: number,
  fileStream: NodeJS.ReadableStream,
  fileName: string,
  notes: string,
): Promise<any> {
  const fs = await import("node:fs");
  const path_module = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const { pipeline } = await import("node:stream/promises");

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    throw new Error("Task not found");
  }

  fs.mkdirSync(getUploadDir(), { recursive: true });

  const storedName = `${randomUUID()}-${safeFileName(fileName)}`;
  const storedPath = path_module.join(getUploadDir(), storedName);

  await pipeline(fileStream, fs.createWriteStream(storedPath));

  const fileUrl = `/uploads/submissions/${storedName}`;

  const [sub] = await db
    .insert(submissionsTable)
    .values({
      taskId,
      submittedById: userId,
      fileUrl,
      notes,
      status: "pending",
    })
    .returning();

  await db.update(tasksTable).set({ status: "submitted" }).where(eq(tasksTable.id, taskId));

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
  if (team?.supervisorId) {
    await createNotification(team.supervisorId, "new_submission", `Team "${team.name}" submitted deliverable for task "${task.title}"`);
  }
  await logActivity("submission_created", `Submitted deliverable for task "${task.title}"`, userId, task.teamId);

  return (await formatSubmissions([sub]))[0];
}

/**
 * Create submission via direct link (without file upload)
 */
export async function createDirectSubmission(taskId: number, userId: number, fileUrl: string, notes: string): Promise<any> {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    throw new Error("Task not found");
  }

  const [sub] = await db
    .insert(submissionsTable)
    .values({ taskId, submittedById: userId, fileUrl, notes, status: "pending" })
    .returning();

  await db.update(tasksTable).set({ status: "submitted" }).where(eq(tasksTable.id, taskId));

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
  if (team?.supervisorId) {
    await createNotification(team.supervisorId, "new_submission", `Team "${team.name}" submitted deliverable for task "${task.title}"`);
  }
  await logActivity("submission_created", `Submitted deliverable for task "${task.title}"`, userId, task.teamId);

  return (await formatSubmissions([sub]))[0];
}

/**
 * Review submission with feedback and status
 */
export async function reviewSubmission(submissionId: number, status: "approved" | "rejected", feedback: string, supervisorId: number): Promise<any> {
  const [sub] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, submissionId));
  if (!sub) {
    throw new Error("Submission not found");
  }

  const [updated] = await db
    .update(submissionsTable)
    .set({ status, feedback })
    .where(eq(submissionsTable.id, submissionId))
    .returning();

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, sub.taskId));
  if (status === "approved") {
    await db.update(tasksTable).set({ status: "reviewed" }).where(eq(tasksTable.id, sub.taskId));
  }

  await createNotification(sub.submittedById, "submission_reviewed", `Your submission for "${task?.title}" has been ${status}`);
  await logActivity("submission_reviewed", `Submission for "${task?.title}" marked as ${status}`, supervisorId, task?.teamId);

  return (await formatSubmissions([updated]))[0];
}
