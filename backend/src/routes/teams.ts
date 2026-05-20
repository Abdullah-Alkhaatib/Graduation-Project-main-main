import { Router } from "express";
import type { IRouter } from "express";
import { db, usersTable, teamsTable, teamMembersTable, invitationsTable, tasksTable, meetingsTable, submissionsTable, teamAnnouncementsTable } from "@workspace/db";
import { eq, ilike, and, sql } from "@workspace/db";
import { requireAuth } from "../lib/session";
import { createNotification, logActivity } from "../lib/notify";

const router: IRouter = Router();
const MAX_TEAM_MEMBERS = 5;

async function formatTeam(team: typeof teamsTable.$inferSelect) {
  const [leader] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, team.leaderId));
  let supervisor = null;
  if (team.supervisorId) {
    const [s] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, team.supervisorId));
    supervisor = s || null;
  }
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, team.id));
  return { ...team, leader, supervisor, memberCount: countResult?.count ?? 0 };
}

async function promoteNextLeader(teamId: number, excludeUserId: number) {
  const remainingMembers = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, teamId));

  const candidates = remainingMembers
    .filter((member) => member.userId !== excludeUserId)
    .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());

  const nextLeader = candidates[0];
  if (!nextLeader) {
    return null;
  }

  await db.update(teamMembersTable)
    .set({ role: "leader" })
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, nextLeader.userId)));

  await db.update(teamsTable)
    .set({ leaderId: nextLeader.userId })
    .where(eq(teamsTable.id, teamId));

  return nextLeader;
}

router.get("/teams", requireAuth, async (req, res): Promise<void> => {
  const { status, search } = req.query as { status?: string; search?: string };
  let teamsQuery = db.select().from(teamsTable);
  const conds = [];

  if (req.user!.role === "supervisor") {
    conds.push(eq(teamsTable.supervisorId, req.user!.id));
  }

  if (status) conds.push(eq(teamsTable.status, status as "forming" | "active" | "supervised" | "completed"));
  if (search) conds.push(ilike(teamsTable.name, `%${search}%`));
  const teams = conds.length > 0 ? await teamsQuery.where(and(...conds)) : await teamsQuery;
  const formatted = await Promise.all(teams.map(formatTeam));
  res.json(formatted);
});

router.post("/teams", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "student") { res.status(403).json({ error: "Only students can create teams" }); return; }
  const existing = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
  if (existing.length > 0) { res.status(400).json({ error: "You are already in a team" }); return; }
  const { name, projectTitle, description, status } = req.body as { name?: string; projectTitle?: string | null; description?: string | null; status?: string };
  if (!name) { res.status(400).json({ error: "Team name is required" }); return; }
  const allowedStatuses = ["forming", "active", "supervised", "completed"];
  const teamStatus = typeof status === "string" && allowedStatuses.includes(status) ? (status as "forming" | "active" | "supervised" | "completed") : undefined;

  const insertValues: any = { name, projectTitle, description, leaderId: req.user!.id };
  if (teamStatus) insertValues.status = teamStatus;

  const [team] = await db.insert(teamsTable).values(insertValues).returning();
  await db.insert(teamMembersTable).values({ teamId: team.id, userId: req.user!.id, role: "leader" });
  await logActivity("team_created", `Team "${name}" created`, req.user!.id, team.id);

  res.status(201).json(await formatTeam(team));
});

router.get("/teams/my", requireAuth, async (req, res): Promise<void> => {
  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
  if (!membership) { res.status(404).json({ error: "Not in a team" }); return; }
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  res.json(await formatTeam(team));
});

router.get("/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, id));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  res.json(await formatTeam(team));
});

router.put("/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, id));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.leaderId !== req.user!.id && req.user!.role !== "coordinator") { res.status(403).json({ error: "Forbidden" }); return; }
  const { name, projectTitle, description, status } = req.body as { name?: string; projectTitle?: string | null; description?: string | null; status?: string };
  const allowedStatuses = ["forming", "active", "supervised", "completed"];
  const updateValues: any = { name, projectTitle, description };
  if (typeof status === "string" && allowedStatuses.includes(status)) {
    updateValues.status = status;
  }
  const [updated] = await db.update(teamsTable).set(updateValues).where(eq(teamsTable.id, id)).returning();
  res.json(await formatTeam(updated));
});

router.get("/teams/:id/members", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, id));
  const result = await Promise.all(members.map(async m => {
    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, m.userId));
    return { ...m, user };
  }));
  res.json(result);
});

// Team announcements (quick ads)
async function formatAnnouncement(a: any) {
  const [leader] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, a.leaderId));
  return { ...a, leader: leader || null };
}

router.get("/team-announcements", requireAuth, async (req, res): Promise<void> => {
  const anns = await db.select().from(teamAnnouncementsTable);
  const formatted = await Promise.all(anns.map(formatAnnouncement));
  res.json(formatted);
});

router.post("/team-announcements", requireAuth, async (req, res): Promise<void> => {
  const { title, description, teamId } = req.body as { title?: string; description?: string | null; teamId?: number | null };
  if (!title) { res.status(400).json({ error: "Title is required" }); return; }

  const leaderId = req.user ? req.user.id : null;
  const insertValues: any = { title, description: description ?? null, leaderId, teamId: teamId ?? null };
  const [ann] = await db.insert(teamAnnouncementsTable).values(insertValues).returning();
  await logActivity("announcement_created", `Announcement "${title}" created`, req.user!.id, ann.teamId ?? null);
  res.status(201).json(await formatAnnouncement(ann));
});

router.put("/team-announcements/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [ann] = await db.select().from(teamAnnouncementsTable).where(eq(teamAnnouncementsTable.id, id));
  if (!ann) { res.status(404).json({ error: "Announcement not found" }); return; }
  if (ann.leaderId !== req.user!.id) { res.status(403).json({ error: "Forbidden" }); return; }

  const { title, description } = req.body as { title?: string; description?: string | null };
  const updateValues: any = {};
  if (title !== undefined) updateValues.title = title;
  if (description !== undefined) updateValues.description = description;

  const [updated] = await db.update(teamAnnouncementsTable).set(updateValues).where(eq(teamAnnouncementsTable.id, id)).returning();
  await logActivity("announcement_updated", `Announcement "${updated.title}" updated`, req.user!.id, ann.teamId ?? null);
  res.json(await formatAnnouncement(updated));
});

router.delete("/team-announcements/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [ann] = await db.select().from(teamAnnouncementsTable).where(eq(teamAnnouncementsTable.id, id));
  if (!ann) { res.status(404).json({ error: "Announcement not found" }); return; }
  if (ann.leaderId !== req.user!.id) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(teamAnnouncementsTable).where(eq(teamAnnouncementsTable.id, id));
  await logActivity("announcement_deleted", `Announcement "${ann.title}" deleted`, req.user!.id, ann.teamId ?? null);
  res.json({ message: "Announcement deleted" });
});


router.post("/teams/:id/join-request", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "student") { res.status(403).json({ error: "Only students can request to join a team" }); return; }

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, id));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.status === "completed") { res.status(400).json({ error: "Cannot join a completed team" }); return; }
  if (team.leaderId === req.user!.id) { res.status(400).json({ error: "You are already the team leader" }); return; }

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, id));
  const memberCount = countResult?.count ?? 0;
  if (memberCount >= MAX_TEAM_MEMBERS) {
    res.status(400).json({ error: `Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.` });
    return;
  }

  const existingMembership = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
  if (existingMembership.length > 0) { res.status(400).json({ error: "You are already in a team" }); return; }

  const existingPending = await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.teamId, id),
        eq(invitationsTable.invitedUserId, team.leaderId),
        eq(invitationsTable.invitedByUserId, req.user!.id),
        eq(invitationsTable.status, "pending"),
      ),
    );

  if (existingPending.length > 0) { res.status(400).json({ error: "Join request already sent" }); return; }

  const [invitation] = await db.insert(invitationsTable).values({
    teamId: id,
    invitedUserId: team.leaderId,
    invitedByUserId: req.user!.id,
  }).returning();

  await createNotification(
    team.leaderId,
    "join_request",
    `${req.user!.name} requested to join your team \"${team.name}\"`,
    invitation.id,
    "invitation",
  );

  await logActivity("join_request_sent", `${req.user!.name} requested to join team \"${team.name}\"`, req.user!.id, id);

  res.status(201).json({ message: "Join request sent" });
});

router.post("/teams/:id/leave", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, id));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  const [membership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, id), eq(teamMembersTable.userId, req.user!.id)));
  if (!membership) { res.status(404).json({ error: "You are not in this team" }); return; }

  if (team.leaderId === req.user!.id) {
    const nextLeader = await promoteNextLeader(id, req.user!.id);
    if (nextLeader) {
      // Leadership transferred successfully
    }
    // Allow leaving even if no one else is in the team
  }

  await db.delete(teamMembersTable).where(and(eq(teamMembersTable.teamId, id), eq(teamMembersTable.userId, req.user!.id)));
  await logActivity("team_left", `${req.user!.name} left team "${team.name}"`, req.user!.id, id);
  // If no members remain, delete related records and the team itself
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, id));
  const remaining = countResult?.count ?? 0;
  if (remaining === 0) {
    // Delete submissions for tasks belonging to this team
    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.teamId, id));
    for (const t of tasks) {
      await db.delete(submissionsTable).where(eq(submissionsTable.taskId, t.id));
    }

    // Delete tasks, meetings, invitations, then the team
    await db.delete(tasksTable).where(eq(tasksTable.teamId, id));
    await db.delete(meetingsTable).where(eq(meetingsTable.teamId, id));
    await db.delete(invitationsTable).where(eq(invitationsTable.teamId, id));
    await db.delete(teamsTable).where(eq(teamsTable.id, id));

    await logActivity("team_deleted", `Team "${team.name}" deleted because no members left`, req.user!.id, id);
  }

  res.json({ message: "Left team successfully" });
});

router.post("/teams/:id/members/:memberId/remove", requireAuth, async (req, res): Promise<void> => {
  const teamRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const memberRaw = Array.isArray(req.params.memberId) ? req.params.memberId[0] : req.params.memberId;
  const teamId = parseInt(teamRaw, 10);
  const memberId = parseInt(memberRaw, 10);
  if (isNaN(teamId) || isNaN(memberId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.leaderId !== req.user!.id) { res.status(403).json({ error: "Only the team leader can remove members" }); return; }
  if (memberId === team.leaderId) { res.status(400).json({ error: "Leader cannot remove themselves here" }); return; }

  const [membership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, memberId)));
  if (!membership) { res.status(404).json({ error: "Member not found in this team" }); return; }

  await db.delete(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, memberId)));
  await createNotification(memberId, "team_removed", `You were removed from team "${team.name}" by the leader`);
  await logActivity("team_member_removed", `${req.user!.name} removed a member from team "${team.name}"`, req.user!.id, teamId);

  // If no members remain, delete related records and the team itself
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  const remaining = countResult?.count ?? 0;
  if (remaining === 0) {
    // Delete submissions for tasks belonging to this team
    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.teamId, teamId));
    for (const t of tasks) {
      await db.delete(submissionsTable).where(eq(submissionsTable.taskId, t.id));
    }

    // Delete tasks, meetings, invitations, then the team
    await db.delete(tasksTable).where(eq(tasksTable.teamId, teamId));
    await db.delete(meetingsTable).where(eq(meetingsTable.teamId, teamId));
    await db.delete(invitationsTable).where(eq(invitationsTable.teamId, teamId));
    await db.delete(teamsTable).where(eq(teamsTable.id, teamId));

    await logActivity("team_deleted", `Team "${team.name}" deleted because no members left`, req.user!.id, teamId);
  }

  res.json({ message: "Member removed successfully" });
});

router.post("/teams/:id/transfer-leader", requireAuth, async (req, res): Promise<void> => {
  const teamRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const teamId = parseInt(teamRaw, 10);
  const { memberId } = req.body;
  const newLeaderId = parseInt(String(memberId || ""), 10);

  if (isNaN(teamId) || isNaN(newLeaderId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.leaderId !== req.user!.id) { res.status(403).json({ error: "Only the current leader can transfer leadership" }); return; }
  if (newLeaderId === team.leaderId) { res.status(400).json({ error: "This member is already the leader" }); return; }

  const [currentLeaderMembership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, req.user!.id)));
  const [targetMembership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, newLeaderId)));

  if (!currentLeaderMembership || !targetMembership) {
    res.status(404).json({ error: "Member not found in this team" });
    return;
  }

  await db.update(teamMembersTable)
    .set({ role: "member" })
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, req.user!.id)));

  await db.update(teamMembersTable)
    .set({ role: "leader" })
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, newLeaderId)));

  await db.update(teamsTable).set({ leaderId: newLeaderId }).where(eq(teamsTable.id, teamId));

  const [newLeader] = await db.select().from(usersTable).where(eq(usersTable.id, newLeaderId));
  await createNotification(newLeaderId, "team_leader_assigned", `You are now the leader of team "${team.name}"`);
  await createNotification(req.user!.id, "team_leader_transferred", `You transferred leadership of team "${team.name}" to ${newLeader?.name || "another member"}`);
  await logActivity("team_leader_transferred", `${req.user!.name} transferred leadership of team "${team.name}" to ${newLeader?.name || "another member"}`, req.user!.id, teamId);

  res.json({ message: "Leadership transferred successfully" });
});

export default router;

