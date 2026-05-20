import { Router } from "express";
import type { IRouter } from "express";
import { db, usersTable, teamsTable, tasksTable, invitationsTable, notificationsTable, supervisorRequestsTable, meetingsTable, teamMembersTable, activityLogsTable } from "@workspace/db";
import { eq, and, sql, desc } from "@workspace/db";
import { requireAuth, requireRole } from "../lib/session";

const router: IRouter = Router();

async function formatTeamBasic(team: typeof teamsTable.$inferSelect) {
  const [leader] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, team.leaderId));
  let supervisor = null;
  if (team.supervisorId) {
    const [s] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, team.supervisorId));
    supervisor = s || null;
  }
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, team.id));
  return { ...team, leader, supervisor, memberCount: countResult?.count ?? 0 };
}

router.get("/dashboard/student", requireAuth, async (req, res): Promise<void> => {
  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
  let team = null;
  let currentPhase = null;
  let pendingTasks = 0;
  let submittedTasks = 0;

  if (membership) {
    const [t] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
    team = t ? await formatTeamBasic(t) : null;
    currentPhase = t?.currentPhase ?? null;

    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.teamId, membership.teamId));
    pendingTasks = tasks.filter(t => t.status === "pending").length;
    submittedTasks = tasks.filter(t => t.status === "submitted").length;
  }

  const invitations = await db.select().from(invitationsTable).where(and(eq(invitationsTable.invitedUserId, req.user!.id), eq(invitationsTable.status, "pending")));
  const notifications = await db.select().from(notificationsTable).where(and(eq(notificationsTable.userId, req.user!.id), eq(notificationsTable.isRead, false)));

  const recentActivity = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.userId, req.user!.id))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(5);
  const activityWithUsers = await Promise.all(recentActivity.map(async a => {
    let user = null;
    if (a.userId) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, a.userId));
      user = u || null;
    }
    return { ...a, user };
  }));

  res.json({ team, currentPhase, pendingTasks, submittedTasks, pendingInvitations: invitations.length, unreadNotifications: notifications.length, recentActivity: activityWithUsers });
});

router.get("/dashboard/supervisor", requireAuth, async (req, res): Promise<void> => {
  const supervisedTeams = await db.select().from(teamsTable).where(eq(teamsTable.supervisorId, req.user!.id));
  const pendingRequests = await db.select().from(supervisorRequestsTable).where(and(eq(supervisorRequestsTable.supervisorId, req.user!.id), eq(supervisorRequestsTable.status, "pending")));

  const teamIds = supervisedTeams.map(t => t.id);
  let pendingReviews = 0;
  if (teamIds.length > 0) {
    const allTasks = await db.select().from(tasksTable);
    const relevantTasks = allTasks.filter(t => teamIds.includes(t.teamId));
    pendingReviews = relevantTasks.filter(t => t.status === "submitted").length;
  }

  const pendingMeetings = await db.select().from(meetingsTable).where(and(eq(meetingsTable.supervisorId, req.user!.id), eq(meetingsTable.status, "pending")));
  const formattedTeams = await Promise.all(supervisedTeams.map(formatTeamBasic));

  const recentActivity = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.userId, req.user!.id))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(5);
  const activityWithUsers = await Promise.all(recentActivity.map(async a => {
    let user = null;
    if (a.userId) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, a.userId));
      user = u || null;
    }
    return { ...a, user };
  }));

  res.json({ assignedTeams: supervisedTeams.length, pendingRequests: pendingRequests.length, pendingReviews, pendingMeetings: pendingMeetings.length, teams: formattedTeams, recentActivity: activityWithUsers });
});

router.get("/dashboard/coordinator", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  const allTeams = await db.select().from(teamsTable);
  const allStudents = await db.select().from(usersTable).where(eq(usersTable.role, "student"));
  const allSupervisors = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.role, "supervisor"));

  // Get students with teams
  const studentsWithTeams = await db.select({ userId: teamMembersTable.userId }).from(teamMembersTable);
  const studentsWithTeamsIds = new Set(studentsWithTeams.map(st => st.userId));
  
  // Get students without teams
  const studentsWithoutTeams = allStudents.filter(s => !studentsWithTeamsIds.has(s.id));

  const unassignedTeams = allTeams.filter(t => !t.supervisorId);
  const assignedTeams = allTeams.filter(t => Boolean(t.supervisorId));
  const proposalTeams = allTeams.filter(t => t.currentPhase === "proposal").length;
  const progressTeams = allTeams.filter(t => t.currentPhase === "progress").length;
  const finalTeams = allTeams.filter(t => t.currentPhase === "final").length;

  const supervisorWorkload = await Promise.all(allSupervisors.map(async (sup) => {
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamsTable).where(eq(teamsTable.supervisorId, sup.id));
    return { supervisor: sup, teamCount: countResult?.count ?? 0 };
  }));

  const allTeamsFormatted = await Promise.all(allTeams.map(formatTeamBasic));
  const unassignedFormatted = await Promise.all(unassignedTeams.slice(0, 10).map(formatTeamBasic));
  const assignedFormatted = await Promise.all(assignedTeams.slice(0, 20).map(formatTeamBasic));

  const recentActivity = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.userId, req.user!.id))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(10);
  const activityWithUsers = await Promise.all(recentActivity.map(async a => {
    let user = null;
    if (a.userId) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, a.userId));
      user = u || null;
    }
    return { ...a, user };
  }));

  res.json({ totalTeams: allTeams.length, unassignedTeams: unassignedTeams.length, totalStudents: allStudents.length, studentsWithoutTeams: studentsWithoutTeams.length, totalSupervisors: allSupervisors.length, teamsPerPhase: { proposal: proposalTeams, progress: progressTeams, final: finalTeams }, supervisorWorkload, allTeamsList: allTeamsFormatted, unassignedTeamsList: unassignedFormatted, assignedTeamsList: assignedFormatted, studentsWithoutTeamsList: studentsWithoutTeams, recentActivity: activityWithUsers });
});

router.get("/activity-logs", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  const logs = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.userId, req.user!.id))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(50);
  const withUsers = await Promise.all(logs.map(async a => {
    let user = null;
    if (a.userId) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, a.userId));
      user = u || null;
    }
    return { ...a, user };
  }));
  res.json(withUsers);
});

export default router;

