import { db, usersTable, teamsTable, submissionsTable, meetingsTable, discussionsTable, phasesTable, invitationsTable } from "@workspace/db";
import { eq, sql, count } from "@workspace/db";

// ============ Coordinator Dashboard ============

/**
 * Get coordinator dashboard statistics
 */
export async function getCoordinatorDashboard(): Promise<any> {
  // Batch fetch all data to avoid N+1 queries
  const [totalStudents] = await db
    .select({ count: count(usersTable.id) })
    .from(usersTable)
    .where(eq(usersTable.role, "student"));

  const [totalSupervisors] = await db
    .select({ count: count(usersTable.id) })
    .from(usersTable)
    .where(eq(usersTable.role, "supervisor"));

  const [totalTeams] = await db
    .select({ count: count(teamsTable.id) })
    .from(teamsTable);

  const [pendingRequests] = await db
    .select({ count: count(invitationsTable.id) })
    .from(invitationsTable)
    .where(eq(invitationsTable.status, "pending"));

  const [pendingSubmissions] = await db
    .select({ count: count(submissionsTable.id) })
    .from(submissionsTable)
    .where(eq(submissionsTable.status, "pending"));

  return {
    statistics: {
      totalStudents: totalStudents.count || 0,
      totalSupervisors: totalSupervisors.count || 0,
      totalTeams: totalTeams.count || 0,
      pendingRequests: pendingRequests.count || 0,
      pendingSubmissions: pendingSubmissions.count || 0,
    },
    timestamp: new Date(),
  };
}

// ============ Supervisor Dashboard ============

/**
 * Get supervisor dashboard with assigned teams summary
 */
export async function getSupervisorDashboard(supervisorId: number): Promise<any> {
  const [teams] = await db
    .select()
    .from(teamsTable)
    .where(eq(teamsTable.supervisorId, supervisorId));

  const teamIds = teams.map((t) => t.id);

  // Batch fetch related data
  const submissions = teamIds.length > 0 ? await db.select().from(submissionsTable).where(sql`${submissionsTable.teamId} IN (${teamIds.join(",")})`) : [];

  const meetings = teamIds.length > 0 ? await db.select().from(meetingsTable).where(sql`${meetingsTable.teamId} IN (${teamIds.join(",")})`) : [];

  const pendingSubmissions = submissions.filter((s) => s.status === "pending").length;
  const pendingMeetings = meetings.filter((m) => m.status === "pending").length;

  return {
    assignedTeams: teams,
    summary: {
      teamCount: teams.length,
      submissionCount: submissions.length,
      pendingSubmissions,
      meetingCount: meetings.length,
      pendingMeetings,
    },
    timestamp: new Date(),
  };
}

// ============ Student Dashboard ============

/**
 * Get student dashboard with team and tasks summary
 */
export async function getStudentDashboard(userId: number): Promise<any> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new Error("User not found");

  // Get team data
  const teams = await db.select().from(teamsTable);
  const userTeam = teams.find((t) => t.leaderId === userId);

  if (!userTeam) {
    return {
      user: { id: user.id, name: user.name, email: user.email },
      team: null,
      submissions: [],
      summary: {
        submissionCount: 0,
        approvedSubmissions: 0,
        pendingSubmissions: 0,
      },
      timestamp: new Date(),
    };
  }

  const submissions = await db.select().from(submissionsTable).where(eq(submissionsTable.teamId, userTeam.id));

  const approvedSubmissions = submissions.filter((s) => s.status === "approved").length;
  const pendingSubmissions = submissions.filter((s) => s.status === "pending").length;

  return {
    user: { id: user.id, name: user.name, email: user.email },
    team: userTeam,
    submissions: submissions.slice(0, 5), // Latest 5
    summary: {
      submissionCount: submissions.length,
      approvedSubmissions,
      pendingSubmissions,
    },
    timestamp: new Date(),
  };
}

// ============ Overall System Health ============

/**
 * Get system-wide health metrics
 */
export async function getSystemHealth(): Promise<any> {
  const [userStats] = await db
    .select({
      students: sql`COUNT(CASE WHEN role = 'student' THEN 1 END)`,
      supervisors: sql`COUNT(CASE WHEN role = 'supervisor' THEN 1 END)`,
      coordinators: sql`COUNT(CASE WHEN role = 'coordinator' THEN 1 END)`,
      total: count(usersTable.id),
    })
    .from(usersTable);

  const [teamStats] = await db
    .select({
      total: count(teamsTable.id),
      withSupervisor: sql`COUNT(CASE WHEN supervisorId IS NOT NULL THEN 1 END)`,
      withoutSupervisor: sql`COUNT(CASE WHEN supervisorId IS NULL THEN 1 END)`,
    })
    .from(teamsTable);

  const [submissionStats] = await db
    .select({
      total: count(submissionsTable.id),
      approved: sql`COUNT(CASE WHEN status = 'approved' THEN 1 END)`,
      pending: sql`COUNT(CASE WHEN status = 'pending' THEN 1 END)`,
      rejected: sql`COUNT(CASE WHEN status = 'rejected' THEN 1 END)`,
    })
    .from(submissionsTable);

  return {
    users: userStats,
    teams: teamStats,
    submissions: submissionStats,
    timestamp: new Date(),
  };
}
