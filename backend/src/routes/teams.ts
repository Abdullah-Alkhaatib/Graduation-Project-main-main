import { Router } from "express";
import type { IRouter } from "express";
import { db, usersTable, teamsTable, teamMembersTable, invitationsTable, tasksTable, meetingsTable, submissionsTable, teamAnnouncementsTable } from "@workspace/db";
import { eq, ilike, and, sql } from "@workspace/db";
import { requireAuth, requireRole } from "../lib/session";
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

async function finalizeLeaveApproval(mainLeaveRequestId: number) {
  const [mainRequest] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, mainLeaveRequestId));
  if (!mainRequest || !mainRequest.approvalTargetUserId) {
    return { status: "missing" as const };
  }

  if (mainRequest.status !== "pending") {
    return { status: mainRequest.status as "accepted" | "rejected" };
  }

  // Get all votes for this leave request
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

  // If any vote is rejected, reject the entire leave request
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

  // Check if all votes are accepted
  const allAccepted = votes.every((vote) => vote.status === "accepted");
  if (!allAccepted) {
    return { status: "pending" as const };
  }

  // All votes accepted - proceed with leaving
  await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, mainLeaveRequestId));

  // Remove user from team
  if (team.leaderId === mainRequest.approvalTargetUserId) {
    // If leader is leaving, promote next leader
    await promoteNextLeader(mainRequest.teamId, mainRequest.approvalTargetUserId);
  }

  await db.delete(teamMembersTable).where(and(eq(teamMembersTable.teamId, mainRequest.teamId), eq(teamMembersTable.userId, mainRequest.approvalTargetUserId)));

  // Check if team is now empty
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, mainRequest.teamId));
  const remaining = countResult?.count ?? 0;
  if (remaining === 0) {
    // Delete team and related data
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

  // Notify leaving user
  if (leavingUser) {
    await createNotification(leavingUser.id, "leave_approved", `Your request to leave team "${team.name}" was approved. You have been removed from the team.`);
  }

  // Notify other members
  const allTeamMembers = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, mainRequest.teamId));
  const otherMembers = allTeamMembers.filter((m) => m.userId !== mainRequest.approvalTargetUserId);
  for (const member of otherMembers) {
    await createNotification(member.userId, "member_left", `${leavingUser?.name} left the team.`);
  }

  await logActivity("team_left", `${leavingUser?.name} left team "${team.name}" after team approval`, leavingUser?.id, mainRequest.teamId);

  return { status: "accepted" as const };
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

// Coordinator: bulk create teams grouping students by gender
router.post("/teams/bulk-create-by-gender", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "coordinator") { res.status(403).json({ error: "Only coordinators can perform this action" }); return; }

  // fetch all students
  const allStudents = await db.select().from(usersTable).where(eq(usersTable.role, "student"));
  const studentsWithTeams = await db.select({ userId: teamMembersTable.userId }).from(teamMembersTable);
  const studentsWithTeamsIds = new Set(studentsWithTeams.map(st => st.userId));
  const studentsWithoutTeams = allStudents.filter(s => !studentsWithTeamsIds.has(s.id));

  // group by gender
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
      await logActivity("team_created", `Team "${teamName}" created by coordinator`, req.user!.id, team.id);
      created.push({ teamId: team.id, name: teamName, gender, members: chunk.map((m: any) => m.id) });
      idx++;
    }
  }

  res.status(201).json({ createdCount: created.length, created });
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

  // Get team member count
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, id));
  const memberCount = countResult?.count ?? 0;

  // If 4 or more members, require approval from other members
  if (memberCount >= 4) {
    // Check if there's already a pending leave request
    const existingRequests = await db
      .select()
      .from(invitationsTable)
      .where(
        and(
          eq(invitationsTable.teamId, id),
          eq(invitationsTable.status, "pending")
        )
      );

    const existingRequest = existingRequests.find(
      (r) => r.approvalTargetUserId === req.user!.id && r.requiresTeamApproval === true
    );

    if (existingRequest) {
      res.status(400).json({ error: "You already have a pending leave request" });
      return;
    }

    // Create the main leave request invitation
    const [mainLeaveRequest] = await db.insert(invitationsTable).values({
      teamId: id,
      invitedUserId: req.user!.id,
      invitedByUserId: req.user!.id,
      status: "pending",
      requiresTeamApproval: true,
      approvalTargetUserId: req.user!.id,
      teamApproved: null,
    }).returning();

    // Get other team members
    const allMembers = await db
      .select()
      .from(teamMembersTable)
      .where(eq(teamMembersTable.teamId, id));
    
    const otherMembers = allMembers.filter((m) => m.userId !== req.user!.id);

    // Create individual approval invitations for each team member and send notifications
    for (const member of otherMembers) {
      // Create approval invitation for this member
      const [approvalInvitation] = await db.insert(invitationsTable).values({
        teamId: id,
        invitedUserId: member.userId,
        invitedByUserId: req.user!.id,
        status: "pending",
        requiresTeamApproval: true,
        approvalForInvitationId: mainLeaveRequest.id,
        approvalTargetUserId: req.user!.id,
      }).returning();

      // Send notification with link to the approval invitation
      await createNotification(
        member.userId,
        "leave_request",
        `${req.user!.name} requested to leave the team "${team.name}". Do you approve?`,
        approvalInvitation.id,
        "leave_request"
      );
    }

    await logActivity("leave_request_sent", `${req.user!.name} requested to leave team "${team.name}"`, req.user!.id, id);
    res.status(202).json({ message: "Leave request sent. Waiting for team approval.", requestId: mainLeaveRequest.id });
    return;
  }

  // If less than 4 members, allow immediate leave
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
  const [newCountResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, id));
  const remaining = newCountResult?.count ?? 0;
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

// Coordinator: add a specific user directly to a team
router.post("/teams/:id/add-member", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const teamId = parseInt(raw, 10);
  const { userId } = req.body as { userId?: number };
  const targetUserId = parseInt(String(userId || ""), 10);
  if (isNaN(teamId) || isNaN(targetUserId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.role !== "student") { res.status(400).json({ error: "Only students can be added to teams" }); return; }

  const existingMembership = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, targetUserId));
  if (existingMembership.length > 0) { res.status(400).json({ error: "User is already in a team" }); return; }

  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  const memberCount = countResult?.count ?? 0;
  if (memberCount >= MAX_TEAM_MEMBERS) { res.status(400).json({ error: `Team is full. Maximum ${MAX_TEAM_MEMBERS} members allowed.` }); return; }

  await db.insert(teamMembersTable).values({ teamId, userId: targetUserId, role: "member" });
  await logActivity("team_member_added", `${req.user!.name} added ${user.name} to team "${team.name}"`, req.user!.id, teamId);
  res.json({ message: "User added to team" });
});

// Coordinator: add a user to an Auto <Gender> team (or create one if none available)
router.post("/teams/add-user-by-gender", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  const { userId } = req.body as { userId?: number };
  const targetUserId = parseInt(String(userId || ""), 10);
  if (isNaN(targetUserId)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.role !== "student") { res.status(400).json({ error: "Only students can be added to teams" }); return; }

  const existingMembership = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, targetUserId));
  if (existingMembership.length > 0) { res.status(400).json({ error: "User is already in a team" }); return; }

  const gender = user.gender ?? "Unknown";
  const prefix = `Auto ${gender} Team`;

  // find existing auto teams for that gender with available slots
  const candidates = await db.select().from(teamsTable).where(ilike(teamsTable.name, `${prefix}%`));

  for (const t of candidates) {
    const [cnt] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, t.id));
    const c = cnt?.count ?? 0;
    if (c < MAX_TEAM_MEMBERS) {
      await db.insert(teamMembersTable).values({ teamId: t.id, userId: targetUserId, role: "member" });
      await logActivity("team_member_added", `${req.user!.name} added ${user.name} to team "${t.name}"`, req.user!.id, t.id);
      res.json({ message: "User added to existing auto gender team", teamId: t.id });
      return;
    }
  }

  // none found — create new auto team with this user as leader
  const samePrefixCount = candidates.length;
  const teamName = `${prefix} ${samePrefixCount + 1}`;
  const [team] = await db.insert(teamsTable).values({ name: teamName, leaderId: targetUserId }).returning();
  await db.insert(teamMembersTable).values({ teamId: team.id, userId: targetUserId, role: "leader" });
  await logActivity("team_created", `Team "${teamName}" created by coordinator (auto gender)`, req.user!.id, team.id);
  res.status(201).json({ message: "New auto gender team created and user added", teamId: team.id });
});

// Get pending leave requests for a team
router.get("/teams/:id/leave-requests", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const teamId = parseInt(raw, 10);
  if (isNaN(teamId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  // Check if user is in this team
  const [membership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, req.user!.id)));
  if (!membership) { res.status(403).json({ error: "You are not in this team" }); return; }

  // Get all pending leave requests for this team (main requests only)
  const allLeaveRequests = await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.teamId, teamId),
        eq(invitationsTable.status, "pending")
      )
    );

  const leaveRequests = allLeaveRequests.filter(
    (lr) => lr.approvalTargetUserId !== null && lr.approvalTargetUserId !== undefined && lr.approvalForInvitationId === null
  );

  // Format requests with user info
  const formatted = await Promise.all(
    leaveRequests.map(async (lr) => {
      const [user] = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, lr.approvalTargetUserId!));
      
      // Count votes for this leave request
      const allVotes = await db
        .select()
        .from(invitationsTable)
        .where(eq(invitationsTable.approvalForInvitationId, lr.id));
      
      const acceptedVotes = allVotes.filter((v) => v.status === "accepted").length;
      const rejectedVotes = allVotes.filter((v) => v.status === "rejected").length;
      const pendingVotes = allVotes.filter((v) => v.status === "pending").length;

      return { ...lr, user: user || null, votes: { accepted: acceptedVotes, rejected: rejectedVotes, pending: pendingVotes } };
    })
  );

  res.json(formatted);
});

export default router;

