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
