import { db, usersTable, teamsTable, teamMembersTable, invitationsTable, teamAnnouncementsTable } from "@workspace/db";
import { eq, ilike, and, sql } from "@workspace/db";
import { createNotification, logActivity } from "../lib/notify";

const MAX_TEAM_MEMBERS = 5;

// ============ Types ============

export type FormattedTeam = {
  id: number;
  name: string;
  projectTitle: string | null;
  description: string | null;
  status: string;
  leaderId: number;
  supervisorId: number | null;
  createdAt: Date;
  leader: { id: number; name: string; email: string; role: string; officeHours: string | null; createdAt: Date } | null;
  supervisor: { id: number; name: string; email: string; role: string; officeHours: string | null; createdAt: Date } | null;
  memberCount: number;
};

export type TeamMemberWithUser = any;

export type TeamAnnouncement = any;

// ============ Formatting Functions ============

/**
 * Format team with leader, supervisor, and member count
 */
export async function formatTeam(team: typeof teamsTable.$inferSelect): Promise<FormattedTeam> {
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
 * Format announcement with leader details
 */
export async function formatAnnouncement(announcement: any): Promise<TeamAnnouncement> {
  const [leader] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, announcement.leaderId));
  return { ...announcement, leader: leader || null };
}

// ============ Team Queries ============

/**
 * Get teams with optional filters (status, search, supervisor)
 */
export async function getTeamsWithFilters(filters: { status?: string; search?: string; supervisorId?: number }): Promise<FormattedTeam[]> {
  const conditions = [];

  if (filters.supervisorId) {
    conditions.push(eq(teamsTable.supervisorId, filters.supervisorId));
  }

  if (filters.status) {
    conditions.push(eq(teamsTable.status, filters.status as "forming" | "active" | "supervised" | "completed"));
  }

  if (filters.search) {
    conditions.push(ilike(teamsTable.name, `%${filters.search}%`));
  }

  const teams = conditions.length > 0 ? await db.select().from(teamsTable).where(and(...conditions)) : await db.select().from(teamsTable);

  return Promise.all(teams.map(formatTeam));
}

/**
 * Get user's team
 */
export async function getUserTeam(userId: number): Promise<FormattedTeam | null> {
  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  if (!membership) {
    return null;
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
  return team ? formatTeam(team) : null;
}

/**
 * Get team by ID with full details
 */
export async function getTeamById(teamId: number): Promise<FormattedTeam | null> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  return team ? formatTeam(team) : null;
}

/**
 * Check if user is in a team
 */
export async function isUserInTeam(userId: number): Promise<boolean> {
  const [existing] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  return !!existing;
}

/**
 * Get team members with user details
 */
export async function getTeamMembers(teamId: number): Promise<TeamMemberWithUser[]> {
  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));

  return Promise.all(
    members.map(async (m) => {
      const [user] = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt })
        .from(usersTable)
        .where(eq(usersTable.id, m.userId));
      return { ...m, user };
    }),
  );
}

/**
 * Get team member count
 */
export async function getTeamMemberCount(teamId: number): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  return result?.count ?? 0;
}

// ============ Team Creation & Modification ============

/**
 * Create a new team by student
 */
export async function createTeam(
  userId: number,
  data: { name: string; projectTitle?: string; description?: string; status?: string },
): Promise<FormattedTeam> {
  const insertValues: any = { name: data.name, projectTitle: data.projectTitle || null, description: data.description || null, leaderId: userId };

  const allowedStatuses = ["forming", "active", "supervised", "completed"];
  if (data.status && allowedStatuses.includes(data.status)) {
    insertValues.status = data.status;
  }

  const [team] = await db.insert(teamsTable).values(insertValues).returning();
  await db.insert(teamMembersTable).values({ teamId: team.id, userId, role: "leader" });
  await logActivity("team_created", `Team "${data.name}" created`, userId, team.id);

  return formatTeam(team);
}

/**
 * Update team details
 */
export async function updateTeam(
  teamId: number,
  data: { name?: string; projectTitle?: string | null; description?: string | null; status?: string },
): Promise<FormattedTeam | null> {
  const updateValues: any = {};

  if (data.name !== undefined) updateValues.name = data.name;
  if (data.projectTitle !== undefined) updateValues.projectTitle = data.projectTitle;
  if (data.description !== undefined) updateValues.description = data.description;

  const allowedStatuses = ["forming", "active", "supervised", "completed"];
  if (data.status && allowedStatuses.includes(data.status)) {
    updateValues.status = data.status;
  }

  const [updated] = await db.update(teamsTable).set(updateValues).where(eq(teamsTable.id, teamId)).returning();

  return updated ? formatTeam(updated) : null;
}

// ============ Team Member Management ============

/**
 * Promote next leader when current leader leaves
 */
export async function promoteNextLeader(teamId: number, excludeUserId: number) {
  const remainingMembers = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));

  const candidates = remainingMembers
    .filter((member) => member.userId !== excludeUserId)
    .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());

  const nextLeader = candidates[0];
  if (!nextLeader) {
    return null;
  }

  await db.update(teamMembersTable).set({ role: "leader" }).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, nextLeader.userId)));

  await db.update(teamsTable).set({ leaderId: nextLeader.userId }).where(eq(teamsTable.id, teamId));

  return nextLeader;
}

/**
 * Check if team can accept new members
 */
export async function canTeamAcceptMembers(teamId: number): Promise<boolean> {
  const count = await getTeamMemberCount(teamId);
  return count < MAX_TEAM_MEMBERS;
}

/**
 * Add member to team
 */
export async function addTeamMember(teamId: number, userId: number, role: "leader" | "member" = "member"): Promise<void> {
  await db.insert(teamMembersTable).values({ teamId, userId, role });
}

/**
 * Remove member from team
 */
export async function removeTeamMember(teamId: number, userId: number): Promise<void> {
  await db.delete(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));
}

// ============ Bulk Operations ============

/**
 * Create teams by grouping students by gender
 */
export async function createTeamsByGender(): Promise<any[]> {
  const allStudents = await db.select().from(usersTable).where(eq(usersTable.role, "student"));
  const studentsWithTeams = await db.select({ userId: teamMembersTable.userId }).from(teamMembersTable);
  const studentsWithTeamsIds = new Set(studentsWithTeams.map((st) => st.userId));
  const studentsWithoutTeams = allStudents.filter((s) => !studentsWithTeamsIds.has(s.id));

  const groups: Record<string, typeof studentsWithoutTeams> = { Female: [], Male: [], Unknown: [] };
  for (const s of studentsWithoutTeams) {
    if (s.gender === "Female") groups.Female.push(s);
    else if (s.gender === "Male") groups.Male.push(s);
    else groups.Unknown.push(s);
  }

  const created: any[] = [];

  function chunkArray<T>(arr: T[], size: number) {
    const res: T[][] = [];
    for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
    return res;
  }

  for (const [gender, list] of Object.entries(groups)) {
    const chunks = chunkArray(list, MAX_TEAM_MEMBERS);
    let idx = 1;
    for (const chunk of chunks) {
      if (chunk.length === 0) continue;
      const leader = chunk[0];
      const teamName = `Auto ${gender} Team ${idx}`;
      const [team] = await db.insert(teamsTable).values({ name: teamName, leaderId: leader.id }).returning();
      for (let i = 0; i < chunk.length; i++) {
        const member = chunk[i];
        const role = i === 0 ? "leader" : "member";
        await db.insert(teamMembersTable).values({ teamId: team.id, userId: member.id, role });
      }
      await logActivity("team_created", `Team "${teamName}" created by coordinator`, leader.id, team.id);
      created.push({ teamId: team.id, name: teamName, gender, members: chunk.map((m: any) => m.id) });
      idx++;
    }
  }

  return created;
}

// ============ Join Requests ============

/**
 * Send join request to team
 */
export async function sendJoinRequest(teamId: number, studentId: number, studentName: string): Promise<void> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  const memberCount = await getTeamMemberCount(teamId);
  if (memberCount >= MAX_TEAM_MEMBERS) {
    throw new Error(`Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.`);
  }

  if (team.leaderId === studentId) {
    throw new Error("You are already the team leader");
  }

  const existingMembership = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, studentId));
  if (existingMembership.length > 0) {
    throw new Error("You are already in a team");
  }

  const existingPending = await db
    .select()
    .from(invitationsTable)
    .where(
      and(eq(invitationsTable.teamId, teamId), eq(invitationsTable.invitedUserId, team.leaderId), eq(invitationsTable.invitedByUserId, studentId), eq(invitationsTable.status, "pending")),
    );

  if (existingPending.length > 0) {
    throw new Error("Join request already sent");
  }

  const [invitation] = await db.insert(invitationsTable).values({
    teamId,
    invitedUserId: team.leaderId,
    invitedByUserId: studentId,
  }).returning();

  await createNotification(team.leaderId, "join_request", `${studentName} requested to join your team "${team.name}"`, invitation.id, "invitation");

  await logActivity("join_request_sent", `${studentName} requested to join team "${team.name}"`, studentId, teamId);
}

// ============ Announcements ============

/**
 * Get all team announcements
 */
export async function getAllAnnouncements(): Promise<TeamAnnouncement[]> {
  const announcements = await db.select().from(teamAnnouncementsTable);
  return Promise.all(announcements.map(formatAnnouncement));
}

/**
 * Create announcement
 */
export async function createAnnouncement(
  leaderId: number,
  leaderName: string,
  data: { title: string; description?: string | null; teamId?: number | null },
): Promise<TeamAnnouncement> {
  if (!data.title) {
    throw new Error("Title is required");
  }

  const [ann] = await db.insert(teamAnnouncementsTable).values({
    title: data.title,
    description: data.description ?? null,
    leaderId,
    teamId: data.teamId ?? null,
  }).returning();

  await logActivity("announcement_created", `Announcement "${data.title}" created`, leaderId, data.teamId ?? null);

  return formatAnnouncement(ann);
}

/**
 * Update announcement
 */
export async function updateAnnouncement(announcementId: number, data: { title?: string; description?: string | null }): Promise<TeamAnnouncement | null> {
  const [existing] = await db.select().from(teamAnnouncementsTable).where(eq(teamAnnouncementsTable.id, announcementId));
  if (!existing) {
    return null;
  }

  const updateValues: any = {};
  if (data.title !== undefined) updateValues.title = data.title;
  if (data.description !== undefined) updateValues.description = data.description;

  const [updated] = await db.update(teamAnnouncementsTable).set(updateValues).where(eq(teamAnnouncementsTable.id, announcementId)).returning();

  await logActivity("announcement_updated", `Announcement "${updated.title}" updated`, existing.leaderId, existing.teamId ?? null);

  return formatAnnouncement(updated);
}

/**
 * Delete announcement
 */
export async function deleteAnnouncement(announcementId: number): Promise<void> {
  const [existing] = await db.select().from(teamAnnouncementsTable).where(eq(teamAnnouncementsTable.id, announcementId));
  if (existing) {
    await db.delete(teamAnnouncementsTable).where(eq(teamAnnouncementsTable.id, announcementId));
    await logActivity("announcement_deleted", `Announcement "${existing.title}" deleted`, existing.leaderId, existing.teamId ?? null);
  }
}
