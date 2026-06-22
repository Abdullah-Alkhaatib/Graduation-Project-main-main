import { db, usersTable, teamsTable } from "@workspace/db";
import { eq, ilike, and } from "@workspace/db";
import { logActivity } from "../lib/notify";

// ============ Types ============

export type PublicUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
};

// ============ Queries ============

/**
 * Get users with optional filters (role, search)
 */
export async function getUsers(filters: { role?: string; search?: string }): Promise<PublicUser[]> {
  let query = db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable);

  const conditions = [];
  if (filters.role) conditions.push(eq(usersTable.role, filters.role as "student" | "supervisor" | "coordinator"));
  if (filters.search) conditions.push(ilike(usersTable.name, `%${filters.search}%`));

  const users = conditions.length > 0 ? await query.where(and(...conditions)) : await query;

  return users;
}

/**
 * Get user by ID
 */
export async function getUserById(userId: number): Promise<PublicUser | null> {
  const [user] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  return user || null;
}

/**
 * Get supervisors with their assigned teams
 */
export async function getSupervisorsWithTeams(): Promise<any[]> {
  const supervisors = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "supervisor"));

  return Promise.all(
    supervisors.map(async (supervisor) => {
      const teams = await db.select().from(teamsTable).where(eq(teamsTable.supervisorId, supervisor.id));
      return { ...supervisor, teams };
    }),
  );
}

// ============ Modifications ============

/**
 * Delete user (coordinator only)
 * Unassigns teams that the supervisor was responsible for
 */
export async function deleteUser(userId: number, coordinatorId: number): Promise<void> {
  const [user] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) {
    throw new Error("User not found");
  }

  if (user.role === "supervisor") {
    // Unassign teams from supervisor
    await db.update(teamsTable).set({ supervisorId: null }).where(eq(teamsTable.supervisorId, userId));
    await logActivity("supervisor_deleted", `Supervisor "${user.name}" deleted and unassigned from teams`, coordinatorId, null);
  } else if (user.role === "student") {
    await logActivity("student_deleted", `Student "${user.name}" deleted`, coordinatorId, null);
  }

  // Delete the user
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}
