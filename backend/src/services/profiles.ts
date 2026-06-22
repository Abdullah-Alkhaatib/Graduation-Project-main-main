import { db, usersTable, studentProfilesTable, teamsTable, teamMembersTable, submissionsTable } from "@workspace/db";
import { eq } from "@workspace/db";

// ============ Profile Queries ============

/**
 * Get student profile with team and submission info
 */
export async function getStudentProfile(userId: number): Promise<any> {
  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, studentId: usersTable.studentId, gender: usersTable.gender, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) return null;

  // Get student profile
  const [profile] = await db.select().from(studentProfilesTable).where(eq(studentProfilesTable.userId, userId));

  // Get team membership
  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  let team = null;
  if (membership) {
    const [teamData] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
    team = teamData;
  }

  // Get submission count
  const submissions = await db
    .select()
    .from(submissionsTable)
    .innerJoin(teamMembersTable, eq(teamMembersTable.teamId, db.select({ teamId: submissionsTable.teamId }).from(submissionsTable).where(eq(submissionsTable.teamId, membership?.teamId || -1))));

  return {
    user,
    profile,
    team,
    submissionCount: submissions.length,
  };
}

/**
 * Get supervisor profile with assigned teams
 */
export async function getSupervisorProfile(userId: number): Promise<any> {
  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user || user.role !== "supervisor") return null;

  // Get assigned teams
  const teams = await db.select().from(teamsTable).where(eq(teamsTable.supervisorId, userId));

  return {
    user,
    assignedTeams: teams,
    teamCount: teams.length,
  };
}

/**
 * Update student profile
 */
export async function updateStudentProfile(userId: number, data: { studentId?: string; gender?: string }): Promise<any> {
  const updateValues: any = {};

  if (data.studentId !== undefined) updateValues.studentId = data.studentId;
  if (data.gender !== undefined) updateValues.gender = data.gender;

  if (Object.keys(updateValues).length === 0) {
    return getStudentProfile(userId);
  }

  await db.update(usersTable).set(updateValues).where(eq(usersTable.id, userId));

  return getStudentProfile(userId);
}
