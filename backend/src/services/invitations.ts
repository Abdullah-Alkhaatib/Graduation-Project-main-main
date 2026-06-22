import { db, invitationsTable, teamsTable, usersTable, teamMembersTable } from "@workspace/db";
import { eq, and } from "@workspace/db";
import { createNotification, logActivity } from "../lib/notify";

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

/**
 * Get team join requests (invitations sent to team leader)
 */
export async function getTeamJoinRequests(teamLeaderId: number): Promise<any[]> {
  const invitations = await db.select().from(invitationsTable).where(eq(invitationsTable.invitedUserId, teamLeaderId));

  return Promise.all(
    invitations.map(async (inv) => {
      const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, inv.teamId));
      const [requestedBy] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, inv.invitedByUserId));
      return { ...inv, team, requestedBy };
    }),
  );
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
