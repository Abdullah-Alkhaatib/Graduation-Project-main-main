import { db, invitationsTable, teamsTable, usersTable, teamMembersTable, studentProfilesTable } from "@workspace/db";
import { eq, and, sql } from "@workspace/db";
import { createNotification, logActivity } from "../lib/notify";
import { finalizeLeaveApproval } from "./teams";

export class ServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MAX_TEAM_MEMBERS = 5;

// ============ Queries ============

/**
 * Get invitations for user (as recipient)
 */
export async function getUserInvitations(userId: number): Promise<any[]> {
  const invitations = await db.select().from(invitationsTable).where(eq(invitationsTable.invitedUserId, userId));

  return Promise.all(
    invitations.map(async (inv) => {
      const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, inv.teamId));
      const [invitedBy] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, inv.invitedByUserId));
      return { ...inv, team, invitedBy };
    }),
  );
}

export async function getTeamMemberCount(teamId: number): Promise<number> {
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, teamId));
  return countResult?.count ?? 0;
}

export async function formatInvitation(inv: typeof invitationsTable.$inferSelect) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, inv.teamId));
  if (!team) return null;

  const [invitedUser] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, inv.invitedUserId));
  const [invitedBy] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, inv.invitedByUserId));
  if (!invitedUser || !invitedBy) return null;

  let approvalTargetUser = null;
  if (inv.approvalTargetUserId) {
    const [targetUser] = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
      .from(usersTable)
      .where(eq(usersTable.id, inv.approvalTargetUserId));
    approvalTargetUser = targetUser || null;
  }

  const [leader] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, team.leaderId));
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, team.id));
  return { ...inv, team: { ...team, leader, supervisor: null, memberCount: countResult?.count ?? 0 }, invitedUser, invitedBy, approvalTargetUser };
}

export async function inviteStudentToTeamByStudentId(teamId: number, studentId: string | number, inviterId: number) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new ServiceError(404, "Team not found");
  }

  if (team.leaderId !== inviterId) {
    throw new ServiceError(403, "Only the team leader can invite students");
  }

  const [studentProfile] = await db.select().from(studentProfilesTable).where(eq(studentProfilesTable.studentId, String(studentId)));
  if (!studentProfile) {
    throw new ServiceError(404, "Student not found");
  }

  const invitedUserId = studentProfile.userId;
  const currentMemberCount = await getTeamMemberCount(team.id);
  if (currentMemberCount >= MAX_TEAM_MEMBERS) {
    throw new ServiceError(400, `Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.`);
  }

  const existingMembership = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, invitedUserId));
  if (existingMembership.length > 0) {
    throw new ServiceError(400, "Student already in a team");
  }

  const pendingForTeam = await db
    .select()
    .from(invitationsTable)
    .where(and(eq(invitationsTable.teamId, teamId), eq(invitationsTable.status, "pending")));

  const duplicatePending = pendingForTeam.some((invitation) => invitation.invitedUserId === invitedUserId && !invitation.approvalForInvitationId);
  if (duplicatePending) {
    throw new ServiceError(400, "A pending invitation already exists for this student");
  }

  const [inv] = await db.insert(invitationsTable).values({
    teamId,
    invitedUserId,
    invitedByUserId: inviterId,
    requiresTeamApproval: true,
    approvalForInvitationId: null,
    approvalTargetUserId: null,
  }).returning();

  const teamMembers = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  const reviewers = teamMembers.filter((member) => member.userId !== inviterId && member.userId !== invitedUserId);

  const [candidateUser] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, invitedUserId));

  if (reviewers.length === 0) {
    await db.update(invitationsTable).set({ teamApproved: true }).where(eq(invitationsTable.id, inv.id));

    if (candidateUser) {
      await createNotification(candidateUser.id, "invitation_ready", `Team "${team.name}" approved your invitation. Please accept or decline to join.`, inv.id, "invitation");
    }

    await createNotification(inviterId, "invitation_team_approved", `Team members approved the invitation for ${candidateUser?.name || "the student"}. Waiting for their response.`);
    await logActivity("invitation_team_approved", `Invitation for ${candidateUser?.name || "a student"} on team "${team.name}" was approved automatically`, inviterId, teamId);
    return inv;
  }

  for (const reviewer of reviewers) {
    const [voteInvitation] = await db.insert(invitationsTable).values({
      teamId,
      invitedUserId: reviewer.userId,
      invitedByUserId: inviterId,
      status: "pending",
      requiresTeamApproval: null,
      approvalForInvitationId: inv.id,
      approvalTargetUserId: invitedUserId,
    }).returning();

    await createNotification(
      reviewer.userId,
      "team_invitation_vote",
      `${candidateUser?.name || "A student"} has been invited to team "${team.name}". Please accept or reject.`,
      voteInvitation.id,
      "invitation",
    );
  }

  await createNotification(invitedUserId, "invitation_under_review", `Your invitation to team "${team.name}" is waiting for team approval`);
  await logActivity("invitation_vote_requested", `Invitation for ${candidateUser?.name || "a student"} to join "${team.name}" is waiting for team approval`, inviterId, teamId);

  return inv;
}

export async function acceptInvitationResponse(invitationId: number, actorId: number) {
  const [inv] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invitationId));
  if (!inv) {
    throw new ServiceError(404, "Invitation not found");
  }

  if (inv.approvalForInvitationId) {
    if (inv.invitedUserId !== actorId) {
      throw new ServiceError(404, "Invitation not found");
    }
    if (inv.status !== "pending") {
      return { message: "Invitation already responded to", status: inv.status };
    }

    await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, invitationId));
    const [mainRequest] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, inv.approvalForInvitationId));
    if (!mainRequest) {
      return { message: "Vote recorded", status: "missing" };
    }

    const result = mainRequest.approvalTargetUserId ? await finalizeLeaveApproval(inv.approvalForInvitationId) : await finalizeTeamApproval(inv.approvalForInvitationId);
    if (result.status === "accepted") {
      return { message: "Vote recorded. Request accepted by team.", status: result.status };
    }
    if (result.status === "rejected") {
      return { message: "Vote recorded. Request rejected by team.", status: result.status };
    }
    return { message: "Vote recorded", status: result.status };
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, inv.teamId));
  if (!team) {
    throw new ServiceError(404, "Team not found");
  }

  if (inv.invitedUserId !== actorId) {
    throw new ServiceError(404, "Invitation not found");
  }

  if (inv.status !== "pending") {
    return { message: "Invitation already responded to", status: inv.status };
  }

  const [actor] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, actorId));
  const actorName = actor?.name || "The team leader";

  const isLeaderJoinRequest = team.leaderId === actorId && inv.invitedByUserId !== actorId;
  if (isLeaderJoinRequest) {
    const [alreadyMember] = await db
      .select()
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, team.id), eq(teamMembersTable.userId, inv.invitedByUserId)));

    if (alreadyMember) {
      await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, invitationId));
      return { message: "Join request already satisfied", status: "accepted" };
    }

    const currentMemberCount = await getTeamMemberCount(team.id);
    if (currentMemberCount >= MAX_TEAM_MEMBERS) {
      throw new ServiceError(400, `Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.`);
    }

    await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, invitationId));
    await db.insert(teamMembersTable).values({ teamId: inv.teamId, userId: inv.invitedByUserId, role: "member" });
    await logActivity("join_request_accepted", `${actorName} accepted a join request for team "${team.name}"`, actorId, inv.teamId);
    await createNotification(inv.invitedByUserId, "join_request_accepted", `Your request to join "${team.name}" has been accepted`);
    return { message: "Join request accepted", status: "accepted" };
  }

  if (inv.requiresTeamApproval && !inv.teamApproved) {
    throw new ServiceError(400, "This invitation is waiting for team approval");
  }

  const existing = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, actorId));
  if (existing.length > 0) {
    throw new ServiceError(400, "You are already in a team");
  }

  const currentMemberCount = await getTeamMemberCount(team.id);
  if (currentMemberCount >= MAX_TEAM_MEMBERS) {
    throw new ServiceError(400, `Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.`);
  }

  await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, invitationId));
  await db.insert(teamMembersTable).values({ teamId: inv.teamId, userId: actorId, role: "member" });
  await logActivity("invitation_accepted", `${actorName} joined team "${team.name}"`, actorId, inv.teamId);
  await createNotification(inv.invitedByUserId, "invitation_accepted", `${actorName} accepted your invitation to join "${team.name}"`);
  return { message: "Invitation accepted", status: "accepted" };
}

export async function rejectInvitationResponse(invitationId: number, actorId: number) {
  const [inv] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invitationId));
  if (!inv) {
    throw new ServiceError(404, "Invitation not found");
  }

  if (inv.approvalForInvitationId) {
    if (inv.invitedUserId !== actorId) {
      throw new ServiceError(404, "Invitation not found");
    }
    if (inv.status !== "pending") {
      return { message: "Invitation already responded to", status: inv.status };
    }

    await db.update(invitationsTable).set({ status: "rejected" }).where(eq(invitationsTable.id, invitationId));
    const [mainRequest] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, inv.approvalForInvitationId));
    if (!mainRequest) {
      return { message: "Vote recorded", status: "missing" };
    }

    const result = mainRequest.approvalTargetUserId ? await finalizeLeaveApproval(inv.approvalForInvitationId) : await finalizeTeamApproval(inv.approvalForInvitationId);
    if (result.status === "rejected") {
      return { message: "Vote recorded. Request rejected by team.", status: result.status };
    }
    return { message: "Vote recorded", status: result.status };
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, inv.teamId));
  if (!team) {
    throw new ServiceError(404, "Team not found");
  }

  const isLeaderJoinRequest = inv.invitedUserId === actorId && team.leaderId === actorId;
  if (!isLeaderJoinRequest && inv.invitedUserId !== actorId) {
    throw new ServiceError(404, "Invitation not found");
  }

  if (inv.status !== "pending") {
    return { message: "Invitation already responded to", status: inv.status };
  }

  await db.update(invitationsTable).set({ status: "rejected" }).where(eq(invitationsTable.id, invitationId));

  if (isLeaderJoinRequest) {
    await createNotification(inv.invitedByUserId, "join_request_rejected", `Your request to join "${team.name}" was rejected`);
    return { message: "Join request rejected", status: "rejected" };
  }

  return { message: "Invitation rejected", status: "rejected" };
}

export async function finalizeTeamApproval(mainInvitationId: number) {
  const [mainInvitation] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, mainInvitationId));
  if (!mainInvitation) {
    return { status: "missing" as const };
  }

  if (mainInvitation.status !== "pending") {
    return { status: mainInvitation.status as "accepted" | "rejected" };
  }

  const votes = await db.select().from(invitationsTable).where(eq(invitationsTable.approvalForInvitationId, mainInvitationId));
  if (votes.length === 0) {
    return { status: "pending" as const };
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, mainInvitation.teamId));
  if (!team) {
    return { status: "missing" as const };
  }

  const [leader] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, mainInvitation.invitedByUserId));
  const [candidate] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, mainInvitation.invitedUserId));

  if (votes.some((vote) => vote.status === "rejected")) {
    await db.update(invitationsTable).set({ status: "rejected" }).where(eq(invitationsTable.id, mainInvitationId));
    for (const vote of votes) {
      if (vote.status === "pending") {
        await db.update(invitationsTable).set({ status: "rejected" }).where(eq(invitationsTable.id, vote.id));
      }
    }

    if (candidate) {
      await createNotification(candidate.id, "invitation_rejected", `Team "${team.name}" declined your invitation request`);
    }
    if (leader) {
      await createNotification(leader.id, "invitation_rejected", `Your invitation to ${candidate?.name || "the student"} was rejected by team members`);
    }
    await logActivity("invitation_rejected_by_team", `Team members rejected invitation for ${candidate?.name || "a student"} in "${team.name}"`, leader?.id, team.id);
    return { status: "rejected" as const };
  }

  const allAccepted = votes.every((vote) => vote.status === "accepted");
  if (!allAccepted) {
    return { status: "pending" as const };
  }

  const currentMemberCount = await getTeamMemberCount(team.id);
  if (currentMemberCount >= MAX_TEAM_MEMBERS) {
    await db.update(invitationsTable).set({ status: "rejected" }).where(eq(invitationsTable.id, mainInvitationId));
    if (candidate) {
      await createNotification(candidate.id, "invitation_rejected", `Team "${team.name}" is full now, so your invitation was cancelled`);
    }
    if (leader) {
      await createNotification(leader.id, "invitation_rejected", `Invitation for ${candidate?.name || "the student"} was cancelled because team "${team.name}" is full`);
    }
    return { status: "rejected" as const };
  }

  const existingMembership = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, mainInvitation.invitedUserId));
  if (existingMembership.length > 0) {
    await db.update(invitationsTable).set({ status: "rejected" }).where(eq(invitationsTable.id, mainInvitationId));
    if (leader) {
      await createNotification(leader.id, "invitation_rejected", `${candidate?.name || "Student"} is already in a team, invitation cancelled`);
    }
    return { status: "rejected" as const };
  }

  await db.update(invitationsTable).set({ teamApproved: true }).where(eq(invitationsTable.id, mainInvitationId));

  if (candidate) {
    await createNotification(candidate.id, "invitation_ready", `Team "${team.name}" approved your invitation. Please accept or decline to join.`, mainInvitationId, "invitation");
  }
  if (leader) {
    await createNotification(leader.id, "invitation_team_approved", `Team members approved the invitation for ${candidate?.name || "the student"}. Waiting for their response.`);
  }
  await logActivity("invitation_team_approved", `Team members approved invitation for ${candidate?.name || "a student"} in "${team.name}"`, leader?.id, team.id);

  return { status: "team_approved" as const };
}

// ============ Invitation Operations ============

/**
 * Accept invitation / join request
 */
export async function acceptInvitation(invitationId: number, teamLeaderId: number): Promise<void> {
  const [invitation] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invitationId));

  if (!invitation) {
    throw new Error("Invitation not found");
  }

  if (invitation.invitedUserId !== teamLeaderId) {
    throw new Error("Not authorized");
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, invitation.teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  // Add user to team
  await db.insert(teamMembersTable).values({
    teamId: invitation.teamId,
    userId: invitation.invitedByUserId,
    role: "member",
  });

  // Mark invitation as accepted
  await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, invitationId));

  // Notify the invited user
  await createNotification(invitation.invitedByUserId, "invitation_accepted", `Your request to join team "${team.name}" has been accepted`);

  await logActivity("invitation_accepted", `${invitation.invitedByUserId} joined team "${team.name}"`, teamLeaderId, invitation.teamId);
}

/**
 * Reject invitation / join request
 */
export async function rejectInvitation(invitationId: number, teamLeaderId: number): Promise<void> {
  const [invitation] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invitationId));

  if (!invitation) {
    throw new Error("Invitation not found");
  }

  if (invitation.invitedUserId !== teamLeaderId) {
    throw new Error("Not authorized");
  }

  // Mark invitation as rejected
  await db.update(invitationsTable).set({ status: "rejected" }).where(eq(invitationsTable.id, invitationId));

  // Notify the invited user
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, invitation.teamId));
  await createNotification(invitation.invitedByUserId, "invitation_rejected", `Your request to join team "${team?.name || "a team"}" has been declined`);

  await logActivity("invitation_rejected", `Join request to team rejected`, teamLeaderId, invitation.teamId);
}

/**
 * Invite user to team (team leader invites students)
 */
export async function inviteUserToTeam(teamId: number, targetUserId: number, inviterId: number): Promise<void> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
  if (!targetUser) {
    throw new Error("User not found");
  }

  // Check if already a member
  const [existing] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetUserId)));
  if (existing) {
    throw new Error("User is already a member of this team");
  }

  // Create invitation
  await db.insert(invitationsTable).values({
    teamId,
    invitedUserId: targetUserId,
    invitedByUserId: inviterId,
  });

  await createNotification(targetUserId, "team_invitation", `You have been invited to join team "${team.name}"`);

  await logActivity("team_invitation_sent", `Invited ${targetUser.name} to team "${team.name}"`, inviterId, teamId);
}
