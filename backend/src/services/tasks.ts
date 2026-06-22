import { db, tasksTable, teamsTable, teamMembersTable } from "@workspace/db";
import { eq } from "@workspace/db";
import { createNotification, logActivity } from "../lib/notify";

// ============ Types ============

export type FormattedTask = any;

// ============ Formatting ============

/**
 * Format task with team details
 */
export async function formatTask(task: typeof tasksTable.$inferSelect): Promise<FormattedTask> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
  return { ...task, team };
}

// ============ Visibility & Permissions ============

/**
 * Check if task is visible to supervisor
 */
export function isTaskVisibleForSupervisor(task: typeof tasksTable.$inferSelect, supervisorId: number | null | undefined): boolean {
  if (!supervisorId) return false;
  return task.supervisorId == null || task.supervisorId === supervisorId;
}

/**
 * Get tasks for student (based on team membership)
 */
export async function getStudentTasks(userId: number): Promise<FormattedTask[]> {
  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  if (!membership) {
    return [];
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
  if (!team || !team.supervisorId) {
    return [];
  }

  const allTasks = await db.select().from(tasksTable).where(eq(tasksTable.teamId, membership.teamId));
  const filtered = allTasks.filter((task) => isTaskVisibleForSupervisor(task, team.supervisorId));

  return Promise.all(filtered.map(formatTask));
}

/**
 * Get tasks for supervisor
 */
export async function getSupervisorTasks(supervisorId: number): Promise<FormattedTask[]> {
  const supervisedTeams = await db.select().from(teamsTable).where(eq(teamsTable.supervisorId, supervisorId));
  const teamIds = supervisedTeams.map((t) => t.id);

  if (teamIds.length === 0) {
    return [];
  }

  const allTasks = await db.select().from(tasksTable);
  const filtered = allTasks.filter((t) => teamIds.includes(t.teamId) && isTaskVisibleForSupervisor(t, supervisorId));

  return Promise.all(filtered.map(formatTask));
}

/**
 * Get all tasks (coordinator view)
 */
export async function getAllTasks(): Promise<FormattedTask[]> {
  const tasks = await db.select().from(tasksTable);
  return Promise.all(tasks.map(formatTask));
}

// ============ Task Queries ============

/**
 * Get task by ID with permission checks
 */
export async function getTaskById(taskId: number, userId: number, userRole: string): Promise<FormattedTask | null> {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    return null;
  }

  // Student permission check
  if (userRole === "student") {
    const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
    if (!membership || membership.teamId !== task.teamId) {
      return null;
    }

    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
    if (!team || !team.supervisorId) {
      return null;
    }

    if (!isTaskVisibleForSupervisor(task, team.supervisorId)) {
      return null;
    }
  }

  // Supervisor permission check
  if (userRole === "supervisor") {
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
    if (!team || team.supervisorId !== userId || !isTaskVisibleForSupervisor(task, userId)) {
      return null;
    }
  }

  return formatTask(task);
}

// ============ Task Creation ============

/**
 * Create a new task
 */
export async function createTask(
  creatorId: number,
  creatorRole: string,
  data: { teamId: number; title: string; description?: string | null; deadline?: string; phase: string },
): Promise<FormattedTask> {
  if (!data.teamId || !data.title || !data.phase) {
    throw new Error("teamId, title, and phase are required");
  }

  if (data.deadline) {
    const deadlineDate = new Date(data.deadline);
    const now = new Date();
    if (deadlineDate <= now) {
      throw new Error("Deadline must be in the future");
    }
  }

  // Supervisor permission check
  if (creatorRole === "supervisor") {
    const assignedTeams = await db.select().from(teamsTable).where(eq(teamsTable.supervisorId, creatorId));
    if (assignedTeams.length === 0) {
      throw new Error("You are not assigned to any team, so you cannot create tasks");
    }
  }

  // Get team
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, data.teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  if (!team.supervisorId) {
    throw new Error("Cannot create tasks for a team without a supervisor");
  }

  // Supervisor can only create for their teams
  if (creatorRole === "supervisor" && team.supervisorId !== creatorId) {
    throw new Error("You can only create tasks for teams assigned to you");
  }

  // Create task
  const [task] = await db
    .insert(tasksTable)
    .values({
      teamId: data.teamId,
      supervisorId: team.supervisorId,
      title: data.title,
      description: data.description || null,
      deadline: data.deadline ? new Date(data.deadline) : null,
      phase: data.phase,
      status: "pending",
    })
    .returning();

  // Notify team members
  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, data.teamId));
  for (const m of members) {
    await createNotification(m.userId, "new_task", `New task "${data.title}" has been assigned to your team`);
  }

  await logActivity("task_created", `Task "${data.title}" created for team "${team.name}"`, creatorId, data.teamId);

  return formatTask(task);
}

// ============ Task Modification ============

/**
 * Update task
 */
export async function updateTask(
  taskId: number,
  creatorId: number,
  creatorRole: string,
  data: { title?: string; description?: string | null; deadline?: string; status?: string },
): Promise<FormattedTask | null> {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    return null;
  }

  // Supervisor permission check
  if (creatorRole === "supervisor") {
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, task.teamId));
    if (!team || team.supervisorId !== creatorId) {
      throw new Error("You can only update tasks for teams assigned to you");
    }
  }

  const updateValues: any = {};
  if (data.title !== undefined) updateValues.title = data.title;
  if (data.description !== undefined) updateValues.description = data.description;
  if (data.deadline !== undefined) updateValues.deadline = data.deadline ? new Date(data.deadline) : task.deadline;
  if (data.status !== undefined) updateValues.status = data.status;

  const [updated] = await db.update(tasksTable).set(updateValues).where(eq(tasksTable.id, taskId)).returning();

  return formatTask(updated);
}
