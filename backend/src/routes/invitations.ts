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

  const [leader] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, team.leaderId));
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, team.id));
  return { ...inv, team: { ...team, leader, supervisor: null, memberCount: countResult?.count ?? 0 }, invitedUser, invitedBy };
}

router.get("/invitations", requireAuth, async (req, res): Promise<void> => {
  const invitations = await db.select().from(invitationsTable).where(eq(invitationsTable.invitedUserId, req.user!.id));
  const formatted = (await Promise.all(invitations.map(formatInvitation))).filter((inv): inv is NonNullable<typeof inv> => Boolean(inv));
  res.json(formatted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
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

  const [inv] = await db.insert(invitationsTable).values({ teamId, invitedUserId, invitedByUserId: req.user!.id }).returning();
  await createNotification(invitedUserId, "invitation", `You have been invited to join team "${team.name}"`, inv.id, "invitation");

  res.status(201).json(await formatInvitation(inv));
});

router.post("/invitations/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [inv] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, id));
  if (!inv) { res.status(404).json({ error: "Invitation not found" }); return; }
  if (inv.status !== "pending") { res.status(400).json({ error: "Invitation already responded to" }); return; }

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

