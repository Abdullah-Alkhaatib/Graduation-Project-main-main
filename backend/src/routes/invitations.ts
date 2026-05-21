import { Router } from "express";
import type { IRouter } from "express";
import { db, usersTable, teamsTable, invitationsTable, teamMembersTable, studentProfilesTable } from "@workspace/db";
import { eq, and, sql } from "@workspace/db";
import { requireAuth } from "../lib/session";
import { createNotification, logActivity } from "../lib/notify";

const router: IRouter = Router();
const MAX_TEAM_MEMBERS = 5;

async function getTeamMemberCount(teamId: number) {
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, teamId));
  return countResult?.count ?? 0;
}

async function formatInvitation(inv: typeof invitationsTable.$inferSelect) {
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

async function finalizeTeamApproval(mainInvitationId: number) {
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

  // Instead of adding the candidate automatically, mark the parent invitation as teamApproved
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

router.get("/invitations", requireAuth, async (req, res): Promise<void> => {
  const invitations = await db.select().from(invitationsTable).where(eq(invitationsTable.invitedUserId, req.user!.id));
  const formatted = (await Promise.all(invitations.map(formatInvitation))).filter((inv): inv is NonNullable<typeof inv> => Boolean(inv));
  const visible = formatted.filter((inv) => {
    // Hide candidate-facing parent invitation when team approval voting is required.
    if (inv.requiresTeamApproval && !inv.approvalForInvitationId) {
      if (inv.team.leaderId === req.user!.id) return true;
      // show parent invitation to the invited user once the team has approved
      if (inv.teamApproved === true && inv.invitedUser?.id === req.user!.id) return true;
      return false;
    }
    return true;
  });
  res.json(visible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
});

router.post("/invitations", requireAuth, async (req, res): Promise<void> => {
  const { teamId, studentId } = req.body;
  if (!teamId || !studentId) { res.status(400).json({ error: "teamId and studentId required" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.leaderId !== req.user!.id) { res.status(403).json({ error: "Only team leader can invite" }); return; }

  // Find the user by student ID
  const [studentProfile] = await db.select().from(studentProfilesTable).where(eq(studentProfilesTable.studentId, studentId));
  if (!studentProfile) { res.status(404).json({ error: "Student not found" }); return; }
  const invitedUserId = studentProfile.userId;

  const currentMemberCount = await getTeamMemberCount(team.id);
  if (currentMemberCount >= MAX_TEAM_MEMBERS) {
    res.status(400).json({ error: `Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.` });
    return;
  }

  const existing = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, invitedUserId));
  if (existing.length > 0) { res.status(400).json({ error: "Student already in a team" }); return; }

  const pendingForTeam = await db
    .select()
    .from(invitationsTable)
    .where(and(eq(invitationsTable.teamId, teamId), eq(invitationsTable.status, "pending")));
  const duplicatePending = pendingForTeam.some((invitation) => invitation.invitedUserId === invitedUserId && !invitation.approvalForInvitationId);
  if (duplicatePending) { res.status(400).json({ error: "A pending invitation already exists for this student" }); return; }

  const [inv] = await db.insert(invitationsTable).values({
    teamId,
    invitedUserId,
    invitedByUserId: req.user!.id,
    requiresTeamApproval: true,
    approvalForInvitationId: null,
    approvalTargetUserId: null,
  }).returning();

  const teamMembers = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  const reviewers = teamMembers.filter((member) => member.userId !== req.user!.id && member.userId !== invitedUserId);

  const [candidateUser] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, invitedUserId));

  if (reviewers.length === 0) {
    await db.insert(teamMembersTable).values({ teamId, userId: invitedUserId, role: "member" });
    await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, inv.id));
    await createNotification(invitedUserId, "invitation_accepted", `You have been added to team "${team.name}"`);
    await createNotification(req.user!.id, "invitation_accepted", `${candidateUser?.name || "Student"} has been added to your team`);
    await logActivity("invitation_auto_accepted", `${candidateUser?.name || "A student"} joined team "${team.name}" (no additional voters)`, req.user!.id, teamId);
    res.status(201).json(await formatInvitation(inv));
    return;
  }

  for (const reviewer of reviewers) {
    const [voteInvitation] = await db.insert(invitationsTable).values({
      teamId,
      invitedUserId: reviewer.userId,
      invitedByUserId: req.user!.id,
      status: "pending",
      requiresTeamApproval: null,
      approvalForInvitationId: inv.id,
      approvalTargetUserId: invitedUserId,
    }).returning();

    await createNotification(
      reviewer.userId,
      "team_invitation_vote",
      `${req.user!.name} invited ${candidateUser?.name || "a student"} to team "${team.name}". Please accept or reject.`,
      voteInvitation.id,
      "invitation",
    );
  }

  await createNotification(invitedUserId, "invitation_under_review", `Your invitation to team "${team.name}" is waiting for team approval`);
  await logActivity("invitation_vote_requested", `${req.user!.name} requested team vote to add ${candidateUser?.name || "a student"} to "${team.name}"`, req.user!.id, teamId);

  res.status(201).json(await formatInvitation(inv));
});

router.post("/invitations/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [inv] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, id));
  if (!inv) { res.status(404).json({ error: "Invitation not found" }); return; }
  if (inv.status !== "pending") { res.status(400).json({ error: "Invitation already responded to" }); return; }

  if (inv.approvalForInvitationId) {
    if (inv.invitedUserId !== req.user!.id) { res.status(404).json({ error: "Invitation not found" }); return; }
    await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, id));
    const finalized = await finalizeTeamApproval(inv.approvalForInvitationId);
    if (finalized.status === "accepted") {
      res.json({ message: "Vote recorded. Invitation accepted by team." });
      return;
    }
    if (finalized.status === "rejected") {
      res.json({ message: "Vote recorded. Invitation rejected by team." });
      return;
    }
    res.json({ message: "Vote recorded" });
    return;
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, inv.teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  const isLeaderJoinRequest = inv.invitedUserId === req.user!.id && team.leaderId === req.user!.id;

  if (isLeaderJoinRequest) {
    const currentMemberCount = await getTeamMemberCount(team.id);
    if (currentMemberCount >= MAX_TEAM_MEMBERS) {
      res.status(400).json({ error: `Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.` });
      return;
    }

    const [alreadyMember] = await db
      .select()
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, team.id), eq(teamMembersTable.userId, inv.invitedByUserId)));

    if (alreadyMember) {
      await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, id));
      res.json({ message: "Join request already satisfied" });
      return;
    }

    await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, id));
    await db.insert(teamMembersTable).values({ teamId: inv.teamId, userId: inv.invitedByUserId, role: "member" });

    await logActivity("join_request_accepted", `${req.user!.name} accepted a join request for team "${team.name}"`, req.user!.id, inv.teamId);
    await createNotification(inv.invitedByUserId, "join_request_accepted", `Your request to join "${team.name}" has been accepted`);

    res.json({ message: "Join request accepted" });
    return;
  }

  if (inv.requiresTeamApproval && !inv.teamApproved) {
    res.status(400).json({ error: "This invitation is waiting for team approval" });
    return;
  }

  if (inv.invitedUserId !== req.user!.id) { res.status(404).json({ error: "Invitation not found" }); return; }

  const existing = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
  if (existing.length > 0) { res.status(400).json({ error: "You are already in a team" }); return; }

  const currentMemberCount = await getTeamMemberCount(team.id);
  if (currentMemberCount >= MAX_TEAM_MEMBERS) {
    res.status(400).json({ error: `Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.` });
    return;
  }

  await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, id));
  await db.insert(teamMembersTable).values({ teamId: inv.teamId, userId: req.user!.id, role: "member" });

  await logActivity("invitation_accepted", `${req.user!.name} joined team "${team.name}"`, req.user!.id, inv.teamId);
  await createNotification(inv.invitedByUserId, "invitation_accepted", `${req.user!.name} accepted your invitation to join "${team.name}"`);

  res.json({ message: "Invitation accepted" });
});

router.post("/invitations/:id/reject", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [inv] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, id));
  if (!inv) { res.status(404).json({ error: "Invitation not found" }); return; }

  if (inv.approvalForInvitationId) {
    if (inv.invitedUserId !== req.user!.id) { res.status(404).json({ error: "Invitation not found" }); return; }
    if (inv.status !== "pending") { res.status(400).json({ error: "Invitation already responded to" }); return; }

    await db.update(invitationsTable).set({ status: "rejected" }).where(eq(invitationsTable.id, id));
    const finalized = await finalizeTeamApproval(inv.approvalForInvitationId);
    if (finalized.status === "rejected") {
      res.json({ message: "Vote recorded. Invitation rejected by team." });
      return;
    }
    res.json({ message: "Vote recorded" });
    return;
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, inv.teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  const isLeaderJoinRequest = inv.invitedUserId === req.user!.id && team.leaderId === req.user!.id;
  if (!isLeaderJoinRequest && inv.invitedUserId !== req.user!.id) { res.status(404).json({ error: "Invitation not found" }); return; }
  if (inv.status !== "pending") { res.status(400).json({ error: "Invitation already responded to" }); return; }

  await db.update(invitationsTable).set({ status: "rejected" }).where(eq(invitationsTable.id, id));

  if (isLeaderJoinRequest) {
    await createNotification(inv.invitedByUserId, "join_request_rejected", `Your request to join \"${team.name}\" was rejected`);
    res.json({ message: "Join request rejected" });
    return;
  }

  res.json({ message: "Invitation rejected" });
});

export default router;

