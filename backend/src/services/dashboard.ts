import { db, usersTable, teamsTable, tasksTable, invitationsTable, notificationsTable, supervisorRequestsTable, meetingsTable, teamMembersTable, activityLogsTable } from "@workspace/db";
import { eq, and, sql, desc, count } from "@workspace/db";

// ============ Formatting ============

/**
 * Format team with leader, supervisor, and member count
 */
export async function formatTeamBasic(team: typeof teamsTable.$inferSelect) {
  const [leader] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, team.leaderId));

  let supervisor = null;
  if (team.supervisorId) {
    const [s] = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt })
      .from(usersTable)
      .where(eq(usersTable.id, team.supervisorId));
    supervisor = s || null;
  }

  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, team.id));

  return { ...team, leader, supervisor, memberCount: countResult?.count ?? 0 };
}

/**
 * Format activity log with user details
 */
export async function formatActivityLog(log: typeof activityLogsTable.$inferSelect) {
  let user = null;
  if (log.userId) {
    const [u] = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
      .from(usersTable)
      .where(eq(usersTable.id, log.userId));
    user = u || null;
  }
  return { ...log, user };
}

// ============ Student Dashboard ============

/**
 * Get student dashboard data
 */
export async function getStudentDashboardData(userId: number): Promise<any> {
  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));

  let team = null;
  let currentPhase = null;
  let pendingTasks = 0;
  let submittedTasks = 0;

  if (membership) {
    const [t] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
    team = t ? await formatTeamBasic(t) : null;
    currentPhase = t?.currentPhase ?? null;

    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.teamId, membership.teamId));
    pendingTasks = tasks.filter((t) => t.status === "pending").length;
    submittedTasks = tasks.filter((t) => t.status === "submitted").length;
  }

  const invitations = await db.select().from(invitationsTable).where(and(eq(invitationsTable.invitedUserId, userId), eq(invitationsTable.status, "pending")));
  const visiblePendingInvitations = invitations.filter((invitation) => !(invitation.requiresTeamApproval && !invitation.approvalForInvitationId));

  const notifications = await db.select().from(notificationsTable).where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));

  const recentActivity = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.userId, userId))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(5);

  const activityWithUsers = await Promise.all(recentActivity.map(formatActivityLog));

  return {
    team,
    currentPhase,
    pendingTasks,
    submittedTasks,
    pendingInvitations: visiblePendingInvitations.length,
    unreadNotifications: notifications.length,
    recentActivity: activityWithUsers,
  };
}

// ============ Supervisor Dashboard ============

/**
 * Get supervisor dashboard data
 */
export async function getSupervisorDashboardData(userId: number): Promise<any> {
  const supervisedTeams = await db.select().from(teamsTable).where(eq(teamsTable.supervisorId, userId));

  const pendingRequests = await db
    .select()
    .from(supervisorRequestsTable)
    .where(and(eq(supervisorRequestsTable.supervisorId, userId), eq(supervisorRequestsTable.status, "pending")));

  const teamIds = supervisedTeams.map((t) => t.id);
  let pendingReviews = 0;

  if (teamIds.length > 0) {
    const allTasks = await db.select().from(tasksTable);
    const relevantTasks = allTasks.filter((t) => teamIds.includes(t.teamId));
    pendingReviews = relevantTasks.filter((t) => t.status === "submitted").length;
  }

  const pendingMeetings = await db
    .select()
    .from(meetingsTable)
    .where(and(eq(meetingsTable.supervisorId, userId), eq(meetingsTable.status, "pending")));

  const formattedTeams = await Promise.all(supervisedTeams.map(formatTeamBasic));

  const recentActivity = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.userId, userId))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(5);

  const activityWithUsers = await Promise.all(recentActivity.map(formatActivityLog));

  return {
    assignedTeams: supervisedTeams.length,
    pendingRequests: pendingRequests.length,
    pendingReviews,
    pendingMeetings: pendingMeetings.length,
    teams: formattedTeams,
    recentActivity: activityWithUsers,
  };
}

// ============ Coordinator Dashboard ============

/**
 * Get coordinator dashboard data
 */
export async function getCoordinatorDashboardData(userId: number): Promise<any> {
  const allTeams = await db.select().from(teamsTable);
  const allStudents = await db.select().from(usersTable).where(eq(usersTable.role, "student"));
  const allSupervisors = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.role, "supervisor"));

  // Get students with teams
  const studentsWithTeams = await db.select({ userId: teamMembersTable.userId }).from(teamMembersTable);
  const studentsWithTeamsIds = new Set(studentsWithTeams.map((st) => st.userId));

  // Get students without teams
  const studentsWithoutTeams = allStudents.filter((s) => !studentsWithTeamsIds.has(s.id));

  const unassignedTeams = allTeams.filter((t) => !t.supervisorId);
  const assignedTeams = allTeams.filter((t) => Boolean(t.supervisorId));
  const proposalTeams = allTeams.filter((t) => t.currentPhase === "proposal").length;
  const progressTeams = allTeams.filter((t) => t.currentPhase === "progress").length;
  const finalTeams = allTeams.filter((t) => t.currentPhase === "final").length;

  const supervisorWorkload = await Promise.all(
    allSupervisors.map(async (sup) => {
      const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamsTable).where(eq(teamsTable.supervisorId, sup.id));
      return { supervisor: sup, teamCount: countResult?.count ?? 0 };
    }),
  );

  const allTeamsFormatted = await Promise.all(allTeams.map(formatTeamBasic));
  const unassignedFormatted = await Promise.all(unassignedTeams.slice(0, 10).map(formatTeamBasic));
  const assignedFormatted = await Promise.all(assignedTeams.slice(0, 20).map(formatTeamBasic));

  const recentActivity = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.userId, userId))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(10);

  const activityWithUsers = await Promise.all(recentActivity.map(formatActivityLog));

  return {
    totalTeams: allTeams.length,
    unassignedTeams: unassignedTeams.length,
    totalStudents: allStudents.length,
    studentsWithoutTeams: studentsWithoutTeams.length,
    totalSupervisors: allSupervisors.length,
    teamsPerPhase: { proposal: proposalTeams, progress: progressTeams, final: finalTeams },
    supervisorWorkload,
    allTeamsList: allTeamsFormatted,
    unassignedTeamsList: unassignedFormatted,
    assignedTeamsList: assignedFormatted,
    studentsWithoutTeamsList: studentsWithoutTeams,
    recentActivity: activityWithUsers,
  };
}

// ============ Activity Logs ============

/**
 * Get recent activity logs for coordinator
 */
export async function getActivityLogs(userId: number, limit: number = 50): Promise<any[]> {
  const logs = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.userId, userId))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(limit);

  return Promise.all(logs.map(formatActivityLog));
}
