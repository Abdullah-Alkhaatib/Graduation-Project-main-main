import { Router } from "express";
import type { IRouter } from "express";
import { db, usersTable, teamsTable, meetingsTable, teamMembersTable } from "@workspace/db";
import { eq, and, sql } from "@workspace/db";
import { requireAuth } from "../lib/session";
import { createNotification, logActivity } from "../lib/notify";

const router: IRouter = Router();

function parseOfficeHours(officeHours: string | null | undefined) {
  if (!officeHours) return [] as string[];
  return officeHours.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

async function formatMeeting(meeting: typeof meetingsTable.$inferSelect) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, meeting.teamId));
  const [requestedBy] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, meeting.requestedById));
  const [supervisor] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, meeting.supervisorId));
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, team.id));
  return { ...meeting, team: { ...team, leader: requestedBy, supervisor, memberCount: countResult?.count ?? 0 }, requestedBy, supervisor };
}

router.get("/meetings", requireAuth, async (req, res): Promise<void> => {
  let meetings: (typeof meetingsTable.$inferSelect)[];
  if (req.user!.role === "supervisor") {
    meetings = await db.select().from(meetingsTable).where(eq(meetingsTable.supervisorId, req.user!.id));
  } else if (req.user!.role === "student") {
    const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
    if (!membership) { res.json([]); return; }
    meetings = await db.select().from(meetingsTable).where(eq(meetingsTable.teamId, membership.teamId));
  } else {
    meetings = await db.select().from(meetingsTable);
  }
  const formatted = await Promise.all(meetings.map(formatMeeting));
  res.json(formatted);
});

router.post("/meetings", requireAuth, async (req, res): Promise<void> => {
  const { supervisorId, proposedDate, notes } = req.body;
  if (!supervisorId || !proposedDate) { res.status(400).json({ error: "supervisorId and proposedDate required" }); return; }

  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
  if (!membership) { res.status(400).json({ error: "You are not in a team" }); return; }

  if (membership.role !== "leader") { res.status(403).json({ error: "Only the team leader can request meetings" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
  if (!team || team.supervisorId !== supervisorId) {
    res.status(400).json({ error: "You can only request meetings with your assigned supervisor" });
    return;
  }

  const [supervisor] = await db.select({ id: usersTable.id, officeHours: usersTable.officeHours }).from(usersTable).where(eq(usersTable.id, supervisorId));
  const allowedSlots = parseOfficeHours(supervisor?.officeHours);
  const requestedSlot = new Date(proposedDate).toISOString();
  if (allowedSlots.length === 0 || !allowedSlots.includes(requestedSlot)) {
    res.status(400).json({ error: "Please choose one of the supervisor's office hours" });
    return;
  }

  const [meeting] = await db.insert(meetingsTable).values({ teamId: membership.teamId, requestedById: req.user!.id, supervisorId, proposedDate: new Date(requestedSlot), notes, status: "pending" }).returning();
  await createNotification(supervisorId, "meeting_request", `Team "${team?.name}" has requested a meeting`);
  await logActivity("meeting_requested", `Meeting requested with supervisor`, req.user!.id, membership.teamId);

  res.status(201).json(await formatMeeting(meeting));
});

router.post("/meetings/:id/approve", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  if (meeting.supervisorId !== req.user!.id && req.user!.role !== "coordinator") { res.status(403).json({ error: "Forbidden" }); return; }
  const [updated] = await db.update(meetingsTable).set({ status: "approved" }).where(eq(meetingsTable.id, id)).returning();
  await createNotification(meeting.requestedById, "meeting_approved", `Your meeting request has been approved`);
  res.json(await formatMeeting(updated));
});

router.post("/meetings/:id/reject", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  if (meeting.supervisorId !== req.user!.id && req.user!.role !== "coordinator") { res.status(403).json({ error: "Forbidden" }); return; }
  const [updated] = await db.update(meetingsTable).set({ status: "rejected" }).where(eq(meetingsTable.id, id)).returning();
  await createNotification(meeting.requestedById, "meeting_rejected", `Your meeting request has been rejected`);
  res.json(await formatMeeting(updated));
});

export default router;

