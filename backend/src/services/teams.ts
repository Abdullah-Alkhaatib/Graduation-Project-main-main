import { db, usersTable, teamsTable, teamMembersTable, invitationsTable, teamAnnouncementsTable, tasksTable, meetingsTable, submissionsTable, studentProfilesTable } from "@workspace/db";
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
  const [existingMembership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  if (existingMembership) {
    throw new Error("You are already in a team");
  }

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
 * Finalize a team member leave approval request
 */
export async function finalizeLeaveApproval(mainLeaveRequestId: number) {
  const [mainRequest] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, mainLeaveRequestId));
  if (!mainRequest || !mainRequest.approvalTargetUserId) {
    return { status: "missing" as const };
  }

  if (mainRequest.status !== "pending") {
    return { status: mainRequest.status as "accepted" | "rejected" };
  }

  const votes = await db.select().from(invitationsTable).where(eq(invitationsTable.approvalForInvitationId, mainLeaveRequestId));
  if (votes.length === 0) {
    return { status: "pending" as const };
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, mainRequest.teamId));
  if (!team) {
    return { status: "missing" as const };
  }

  const [leavingUser] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, mainRequest.approvalTargetUserId));

  if (votes.some((vote) => vote.status === "rejected")) {
    await db.update(invitationsTable).set({ status: "rejected" }).where(eq(invitationsTable.id, mainLeaveRequestId));
    for (const vote of votes) {
      if (vote.status === "pending") {
        await db.update(invitationsTable).set({ status: "rejected" }).where(eq(invitationsTable.id, vote.id));
      }
    }

    if (leavingUser) {
      await createNotification(leavingUser.id, "leave_rejected", `Your request to leave team "${team.name}" was rejected by team members`);
    }
    await logActivity("leave_request_rejected", `${leavingUser?.name}'s leave request from team "${team.name}" was rejected`, leavingUser?.id, team.id);
    return { status: "rejected" as const };
  }

  const allAccepted = votes.every((vote) => vote.status === "accepted");
  if (!allAccepted) {
    return { status: "pending" as const };
  }

  await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, mainLeaveRequestId));

  if (team.leaderId === mainRequest.approvalTargetUserId) {
    await promoteNextLeader(mainRequest.teamId, mainRequest.approvalTargetUserId);
  }

  await db.delete(teamMembersTable).where(and(eq(teamMembersTable.teamId, mainRequest.teamId), eq(teamMembersTable.userId, mainRequest.approvalTargetUserId)));

  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, mainRequest.teamId));
  const remaining = countResult?.count ?? 0;
  if (remaining === 0) {
    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.teamId, mainRequest.teamId));
    for (const t of tasks) {
      await db.delete(submissionsTable).where(eq(submissionsTable.taskId, t.id));
    }
    await db.delete(tasksTable).where(eq(tasksTable.teamId, mainRequest.teamId));
    await db.delete(meetingsTable).where(eq(meetingsTable.teamId, mainRequest.teamId));
    await db.delete(invitationsTable).where(eq(invitationsTable.teamId, mainRequest.teamId));
    await db.delete(teamsTable).where(eq(teamsTable.id, mainRequest.teamId));
    await logActivity("team_deleted", `Team "${team.name}" deleted because no members left`, leavingUser?.id, mainRequest.teamId);
  }

  if (leavingUser) {
    await createNotification(leavingUser.id, "leave_approved", `Your request to leave team "${team.name}" was approved. You have been removed from the team.`);
  }

  const allTeamMembers = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, mainRequest.teamId));
  const otherMembers = allTeamMembers.filter((m) => m.userId !== mainRequest.approvalTargetUserId);
  for (const member of otherMembers) {
    await createNotification(member.userId, "member_left", `${leavingUser?.name} left the team.`);
  }

  await logActivity("team_left", `${leavingUser?.name} left team "${team.name}" after team approval`, leavingUser?.id, mainRequest.teamId);

  return { status: "accepted" as const };
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
export async function createTeamsByGender(coordinatorId: number): Promise<any[]> {
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
      await logActivity("team_created", `Team "${teamName}" created by coordinator`, coordinatorId, team.id);
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
export async function sendJoinRequest(teamId: number, studentId: number, requesterId: number, requesterName: string): Promise<void> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  if (team.leaderId !== requesterId) {
    throw new Error("Only the team leader can request to add a student");
  }

  const [studentProfile] = await db.select().from(studentProfilesTable).where(eq(studentProfilesTable.studentId, studentId));
  if (!studentProfile) {
    throw new Error("Student not found");
  }

  const invitedUserId = studentProfile.userId;
  const memberCount = await getTeamMemberCount(teamId);
  if (memberCount >= MAX_TEAM_MEMBERS) {
    throw new Error(`Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.`);
  }

  const existingMembership = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, invitedUserId));
  if (existingMembership.length > 0) {
    throw new Error("Student already in a team");
  }

  const pendingForTeam = await db
    .select()
    .from(invitationsTable)
    .where(and(eq(invitationsTable.teamId, teamId), eq(invitationsTable.status, "pending")));
  const duplicatePending = pendingForTeam.some((invitation) => invitation.invitedUserId === invitedUserId && !invitation.approvalForInvitationId);
  if (duplicatePending) {
    throw new Error("A pending invitation already exists for this student");
  }

  const [inv] = await db.insert(invitationsTable).values({
    teamId,
    invitedUserId,
    invitedByUserId: requesterId,
    requiresTeamApproval: true,
    approvalForInvitationId: null,
    approvalTargetUserId: null,
  }).returning();

  const teamMembers = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  const reviewers = teamMembers.filter((member) => member.userId !== requesterId && member.userId !== invitedUserId);

  const [candidateUser] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, invitedUserId));

  if (reviewers.length === 0) {
    await db.update(invitationsTable).set({ teamApproved: true }).where(eq(invitationsTable.id, inv.id));

    if (candidateUser) {
      await createNotification(candidateUser.id, "invitation_ready", `Team "${team.name}" approved your invitation. Please accept or decline to join.`, inv.id, "invitation");
    }
    await createNotification(requesterId, "invitation_team_approved", `Team members approved the invitation for ${candidateUser?.name || "the student"}. Waiting for their response.`);
    await logActivity("invitation_team_approved", `${requesterName} invited ${candidateUser?.name || "a student"} to "${team.name}" (no reviewers) — awaiting candidate response`, requesterId, teamId);
    return;
  }

  for (const reviewer of reviewers) {
    const [voteInvitation] = await db.insert(invitationsTable).values({
      teamId,
      invitedUserId: reviewer.userId,
      invitedByUserId: requesterId,
      status: "pending",
      requiresTeamApproval: null,
      approvalForInvitationId: inv.id,
      approvalTargetUserId: invitedUserId,
    }).returning();

    await createNotification(
      reviewer.userId,
      "team_invitation_vote",
      `${requesterName} invited ${candidateUser?.name || "a student"} to team "${team.name}". Please accept or reject.`,
      voteInvitation.id,
      "invitation",
    );
  }

  await createNotification(invitedUserId, "invitation_under_review", `Your invitation to team "${team.name}" is waiting for team approval`);
  await logActivity("invitation_vote_requested", `${requesterName} requested team vote to add ${candidateUser?.name || "a student"} to "${team.name}"`, requesterId, teamId);
}

export async function requestJoinTeam(teamId: number, userId: number, requesterName: string): Promise<{ message: string }> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  const memberCount = await getTeamMemberCount(teamId);
  if (memberCount >= MAX_TEAM_MEMBERS) {
    throw new Error(`Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.`);
  }

  const existingMembership = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  if (existingMembership.length > 0) {
    throw new Error("You are already in a team");
  }

  const existingPending = await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.teamId, teamId),
        eq(invitationsTable.invitedUserId, team.leaderId),
        eq(invitationsTable.invitedByUserId, userId),
        eq(invitationsTable.status, "pending"),
      ),
    );

  if (existingPending.length > 0) {
    throw new Error("Join request already sent");
  }

  const [invitation] = await db.insert(invitationsTable).values({
    teamId,
    invitedUserId: team.leaderId,
    invitedByUserId: userId,
  }).returning();

  await createNotification(
    team.leaderId,
    "join_request",
    `${requesterName} requested to join your team "${team.name}"`,
    invitation.id,
    "invitation",
  );

  await logActivity("join_request_sent", `${requesterName} requested to join team "${team.name}"`, userId, teamId);

  return { message: "Join request sent" };
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

  await logActivity("announcement_created", `Announcement "${data.title}" created`, leaderId, data.teamId ?? undefined);

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

  await logActivity("announcement_updated", `Announcement "${updated.title}" updated`, existing.leaderId, existing.teamId ?? undefined);

  return formatAnnouncement(updated);
}

/**
 * Delete announcement
 */
export async function deleteAnnouncement(announcementId: number): Promise<void> {
  const [existing] = await db.select().from(teamAnnouncementsTable).where(eq(teamAnnouncementsTable.id, announcementId));
  if (existing) {
    await db.delete(teamAnnouncementsTable).where(eq(teamAnnouncementsTable.id, announcementId));
    await logActivity("announcement_deleted", `Announcement "${existing.title}" deleted`, existing.leaderId, existing.teamId ?? undefined);
  }
}

export async function updateTeamForUser(
  teamId: number,
  data: { name?: string; projectTitle?: string | null; description?: string | null; status?: string },
  userId: number,
  userRole: string,
): Promise<FormattedTeam> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  if (team.leaderId !== userId && userRole !== "coordinator") {
    throw new Error("Forbidden");
  }

  const updated = await updateTeam(teamId, data);
  if (!updated) {
    throw new Error("Failed to update team");
  }

  return updated;
}

export async function updateAnnouncementById(
  announcementId: number,
  data: { title?: string; description?: string | null },
  userId: number,
): Promise<TeamAnnouncement> {
  const [existing] = await db.select().from(teamAnnouncementsTable).where(eq(teamAnnouncementsTable.id, announcementId));
  if (!existing) {
    throw new Error("Announcement not found");
  }

  if (existing.leaderId !== userId) {
    throw new Error("Forbidden");
  }

  const updated = await updateAnnouncement(announcementId, data);
  if (!updated) {
    throw new Error("Failed to update announcement");
  }

  return updated;
}

export async function deleteAnnouncementById(announcementId: number, userId: number): Promise<void> {
  const [existing] = await db.select().from(teamAnnouncementsTable).where(eq(teamAnnouncementsTable.id, announcementId));
  if (!existing) {
    throw new Error("Announcement not found");
  }

  if (existing.leaderId !== userId) {
    throw new Error("Forbidden");
  }

  await deleteAnnouncement(announcementId);
}

export async function requestLeaveTeam(teamId: number, userId: number, userName: string): Promise<{ message: string; requestId?: number; isPending: boolean }> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  const [membership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));
  if (!membership) {
    throw new Error("You are not in this team");
  }

  const memberCount = await getTeamMemberCount(teamId);
  if (memberCount >= 4) {
    const existingRequests = await db
      .select()
      .from(invitationsTable)
      .where(and(eq(invitationsTable.teamId, teamId), eq(invitationsTable.status, "pending")));

    const existingRequest = existingRequests.find(
      (r) => r.approvalTargetUserId === userId && r.requiresTeamApproval === true,
    );

    if (existingRequest) {
      throw new Error("You already have a pending leave request");
    }

    const [mainLeaveRequest] = await db.insert(invitationsTable).values({
      teamId,
      invitedUserId: userId,
      invitedByUserId: userId,
      status: "pending",
      requiresTeamApproval: true,
      approvalTargetUserId: userId,
      teamApproved: null,
    }).returning();

    const allMembers = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
    const otherMembers = allMembers.filter((m) => m.userId !== userId);

    for (const member of otherMembers) {
      const [approvalInvitation] = await db.insert(invitationsTable).values({
        teamId,
        invitedUserId: member.userId,
        invitedByUserId: userId,
        status: "pending",
        requiresTeamApproval: true,
        approvalForInvitationId: mainLeaveRequest.id,
        approvalTargetUserId: userId,
      }).returning();

      await createNotification(
        member.userId,
        "leave_request",
        `${userName} requested to leave the team "${team.name}". Do you approve?`,
        approvalInvitation.id,
        "leave_request",
      );
    }

    await logActivity("leave_request_sent", `${userName} requested to leave team "${team.name}"`, userId, teamId);
    return { message: "Leave request sent. Waiting for team approval.", requestId: mainLeaveRequest.id, isPending: true };
  }

  if (team.leaderId === userId) {
    await promoteNextLeader(teamId, userId);
  }

  await removeTeamMember(teamId, userId);
  await logActivity("team_left", `${userName} left team "${team.name}"`, userId, teamId);

  const [newCountResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  const remaining = newCountResult?.count ?? 0;
  if (remaining === 0) {
    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.teamId, teamId));
    for (const t of tasks) {
      await db.delete(submissionsTable).where(eq(submissionsTable.taskId, t.id));
    }
    await db.delete(tasksTable).where(eq(tasksTable.teamId, teamId));
    await db.delete(meetingsTable).where(eq(meetingsTable.teamId, teamId));
    await db.delete(invitationsTable).where(eq(invitationsTable.teamId, teamId));
    await db.delete(teamsTable).where(eq(teamsTable.id, teamId));
    await logActivity("team_deleted", `Team "${team.name}" deleted because no members left`, userId, teamId);
  }

  return { message: "Left team successfully", isPending: false };
}

export async function removeTeamMemberFromTeam(
  teamId: number,
  memberId: number,
  currentLeaderId: number,
  currentLeaderName: string,
): Promise<{ message: string }> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  if (team.leaderId !== currentLeaderId) {
    throw new Error("Only the team leader can remove members");
  }

  const [membership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, memberId)));
  if (!membership) {
    throw new Error("Member not found in this team");
  }

  if (memberId === team.leaderId) {
    throw new Error("Leader cannot remove themselves here");
  }

  await removeTeamMember(teamId, memberId);
  await createNotification(memberId, "team_removed", `You were removed from team "${team.name}" by the leader`);
  await logActivity("team_member_removed", `${currentLeaderName} removed a member from team "${team.name}"`, currentLeaderId, teamId);

  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  const remaining = countResult?.count ?? 0;

  if (remaining === 0) {
    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.teamId, teamId));
    for (const t of tasks) {
      await db.delete(submissionsTable).where(eq(submissionsTable.taskId, t.id));
    }
    await db.delete(tasksTable).where(eq(tasksTable.teamId, teamId));
    await db.delete(meetingsTable).where(eq(meetingsTable.teamId, teamId));
    await db.delete(invitationsTable).where(eq(invitationsTable.teamId, teamId));
    await db.delete(teamsTable).where(eq(teamsTable.id, teamId));
    await logActivity("team_deleted", `Team "${team.name}" deleted because no members left`, currentLeaderId, teamId);
  }

  return { message: "Member removed successfully" };
}

export async function transferTeamLeader(teamId: number, currentLeaderId: number, newLeaderId: number): Promise<{ message: string }> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  if (team.leaderId !== currentLeaderId) {
    throw new Error("Only the current leader can transfer leadership");
  }

  if (newLeaderId === team.leaderId) {
    throw new Error("This member is already the leader");
  }

  const [currentLeaderMembership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, currentLeaderId)));
  const [targetMembership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, newLeaderId)));

  if (!currentLeaderMembership || !targetMembership) {
    throw new Error("Member not found in this team");
  }

  await db.update(teamMembersTable)
    .set({ role: "member" })
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, currentLeaderId)));

  await db.update(teamMembersTable)
    .set({ role: "leader" })
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, newLeaderId)));

  await db.update(teamsTable).set({ leaderId: newLeaderId }).where(eq(teamsTable.id, teamId));

  const [newLeader] = await db.select().from(usersTable).where(eq(usersTable.id, newLeaderId));
  await createNotification(newLeaderId, "team_leader_assigned", `You are now the leader of team "${team.name}"`);
  await createNotification(currentLeaderId, "team_leader_transferred", `You transferred leadership of team "${team.name}" to ${newLeader?.name || "another member"}`);
  await logActivity("team_leader_transferred", `Team leader transferred from ${currentLeaderId} to ${newLeader?.name || "another member"} for team "${team.name}"`, currentLeaderId, teamId);

  return { message: "Leadership transferred successfully" };
}

export async function addStudentToTeam(teamId: number, targetUserId: number, addedByUserId: number): Promise<{ message: string }> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
  if (!user) {
    throw new Error("User not found");
  }

  if (user.role !== "student") {
    throw new Error("Only students can be added to teams");
  }

  const [existingMembership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, targetUserId));
  if (existingMembership) {
    throw new Error("User is already in a team");
  }

  const memberCount = await getTeamMemberCount(teamId);
  if (memberCount >= MAX_TEAM_MEMBERS) {
    throw new Error(`Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.`);
  }

  await addTeamMember(teamId, targetUserId, "member");
  await logActivity("team_member_added", `${addedByUserId} added ${user.name} to team "${team.name}"`, addedByUserId, teamId);

  return { message: "User added to team" };
}

export async function addUserByGenderToAutoTeam(targetUserId: number, addedByUserId: number): Promise<{ message: string; teamId: number; createdNewTeam: boolean }> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
  if (!user) {
    throw new Error("User not found");
  }

  if (user.role !== "student") {
    throw new Error("Only students can be added to teams");
  }

  const [existingMembership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, targetUserId));
  if (existingMembership) {
    throw new Error("User is already in a team");
  }

  const gender = user.gender ?? "Unknown";
  const prefix = `Auto ${gender} Team`;
  const candidates = await db.select().from(teamsTable).where(ilike(teamsTable.name, `${prefix}%`));

  for (const t of candidates) {
    const [cnt] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, t.id));
    const c = cnt?.count ?? 0;
    if (c < MAX_TEAM_MEMBERS) {
      await addTeamMember(t.id, targetUserId, "member");
      await logActivity("team_member_added", `${addedByUserId} added ${user.name} to team "${t.name}"`, addedByUserId, t.id);
      return { message: "User added to existing auto gender team", teamId: t.id, createdNewTeam: false };
    }
  }

  const samePrefixCount = candidates.length;
  const teamName = `${prefix} ${samePrefixCount + 1}`;
  const [team] = await db.insert(teamsTable).values({ name: teamName, leaderId: targetUserId }).returning();
  await db.insert(teamMembersTable).values({ teamId: team.id, userId: targetUserId, role: "leader" });
  await logActivity("team_created", `Team "${teamName}" created by coordinator (auto gender)`, addedByUserId, team.id);

  return { message: "New auto gender team created and user added", teamId: team.id, createdNewTeam: true };
}

export async function getTeamLeaveRequests(teamId: number, userId: number): Promise<any[]> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  const [membership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));
  if (!membership) {
    throw new Error("You are not in this team");
  }

  const allLeaveRequests = await db
    .select()
    .from(invitationsTable)
    .where(and(eq(invitationsTable.teamId, teamId), eq(invitationsTable.status, "pending")));

  const leaveRequests = allLeaveRequests.filter(
    (lr) => lr.approvalTargetUserId !== null && lr.approvalTargetUserId !== undefined && lr.approvalForInvitationId === null,
  );

  return Promise.all(
    leaveRequests.map(async (lr) => {
      const [user] = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, lr.approvalTargetUserId!));

      const allVotes = await db
        .select()
        .from(invitationsTable)
        .where(eq(invitationsTable.approvalForInvitationId, lr.id));

      const acceptedVotes = allVotes.filter((v) => v.status === "accepted").length;
      const rejectedVotes = allVotes.filter((v) => v.status === "rejected").length;
      const pendingVotes = allVotes.filter((v) => v.status === "pending").length;

      return { ...lr, user: user || null, votes: { accepted: acceptedVotes, rejected: rejectedVotes, pending: pendingVotes } };
    }),
  );
}
