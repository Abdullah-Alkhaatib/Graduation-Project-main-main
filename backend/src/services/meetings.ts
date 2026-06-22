import { db, meetingsTable, teamsTable, usersTable, teamMembersTable, sql } from "@workspace/db";
import { eq } from "@workspace/db";
import { createNotification, logActivity } from "../lib/notify";

// ============ Formatting ============

/**
 * Parse office hours from string format
 */
export function parseOfficeHours(officeHours: string | null | undefined): string[] {
  if (!officeHours) return [];
  return officeHours.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

/**
 * Format meeting with team and user details
 */
export async function formatMeeting(meeting: typeof meetingsTable.$inferSelect) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, meeting.teamId));
  const [requestedBy] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, meeting.requestedById));
  const [supervisor] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, meeting.supervisorId));
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, team.id));
  return { ...meeting, team: { ...team, leader: requestedBy, supervisor, memberCount: countResult?.count ?? 0 }, requestedBy, supervisor };
}

// ============ Meeting Queries ============

/**
 * Get meetings for supervisor
 */
export async function getSupervisorMeetings(supervisorId: number) {
  const meetings = await db.select().from(meetingsTable).where(eq(meetingsTable.supervisorId, supervisorId));
  return Promise.all(meetings.map(formatMeeting));
}

/**
 * Get meetings for student (based on team membership)
 */
export async function getStudentMeetings(userId: number) {
  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  if (!membership) return [];
  const meetings = await db.select().from(meetingsTable).where(eq(meetingsTable.teamId, membership.teamId));
  return Promise.all(meetings.map(formatMeeting));
}

/**
 * Get all meetings (coordinator view)
 */
export async function getAllMeetings() {
  const meetings = await db.select().from(meetingsTable);
  return Promise.all(meetings.map(formatMeeting));
}

// ============ Meeting Operations ============

/**
 * Create meeting request
 */
export async function createMeetingRequest(
  userId: number,
  data: { supervisorId: number; proposedDate: string; notes?: string },
) {
  const { supervisorId, proposedDate, notes } = data;

  if (!supervisorId || !proposedDate) {
    throw new Error("supervisorId and proposedDate required");
  }

  // Verify user is a team leader
  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  if (!membership) {
    throw new Error("You are not in a team");
  }

  if (membership.role !== "leader") {
    throw new Error("Only the team leader can request meetings");
  }

  // Verify team has the requested supervisor
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
  if (!team || team.supervisorId !== supervisorId) {
    throw new Error("You can only request meetings with your assigned supervisor");
  }

  // Verify proposed date is in supervisor's office hours
  const [supervisor] = await db.select({ id: usersTable.id, officeHours: usersTable.officeHours }).from(usersTable).where(eq(usersTable.id, supervisorId));
  const allowedSlots = parseOfficeHours(supervisor?.officeHours);
  const requestedSlot = new Date(proposedDate).toISOString();
  if (allowedSlots.length === 0 || !allowedSlots.includes(requestedSlot)) {
    throw new Error("Please choose one of the supervisor's office hours");
  }

  // Create meeting
  const [meeting] = await db.insert(meetingsTable).values({
    teamId: membership.teamId,
    requestedById: userId,
    supervisorId,
    proposedDate: new Date(requestedSlot),
    notes: notes || null,
    status: "pending",
  }).returning();

  // Notify supervisor
  await createNotification(supervisorId, "meeting_request", `Team "${team?.name}" has requested a meeting`);
  await logActivity("meeting_requested", `Meeting requested with supervisor`, userId, membership.teamId);

  return formatMeeting(meeting);
}

/**
 * Approve meeting
 */
export async function approveMeeting(meetingId: number, userId: number, userRole: string) {
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (!meeting) {
    throw new Error("Meeting not found");
  }

  // Check permissions
  if (meeting.supervisorId !== userId && userRole !== "coordinator") {
    throw new Error("Forbidden");
  }

  const [updated] = await db.update(meetingsTable).set({ status: "approved" }).where(eq(meetingsTable.id, meetingId)).returning();
  await createNotification(meeting.requestedById, "meeting_approved", `Your meeting request has been approved`);

  return formatMeeting(updated);
}

/**
 * Reject meeting
 */
export async function rejectMeeting(meetingId: number, userId: number, userRole: string) {
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (!meeting) {
    throw new Error("Meeting not found");
  }

  // Check permissions
  if (meeting.supervisorId !== userId && userRole !== "coordinator") {
    throw new Error("Forbidden");
  }

  const [updated] = await db.update(meetingsTable).set({ status: "rejected" }).where(eq(meetingsTable.id, meetingId)).returning();
  await createNotification(meeting.requestedById, "meeting_rejected", `Your meeting request has been rejected`);

  return formatMeeting(updated);
}
