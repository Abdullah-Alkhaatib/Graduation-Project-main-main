import { db, meetingsTable, teamsTable, usersTable, teamMembersTable, meetingNoteItemsTable } from "@workspace/db";
import { eq, and, ilike } from "@workspace/db";
import { createNotification, logActivity } from "../lib/notify";

// ============ Queries ============

/**
 * Get meetings with team and participants
 */
export async function formatMeeting(meeting: typeof meetingsTable.$inferSelect): Promise<any> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, meeting.teamId));
  const [initiatedBy] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, meeting.initiatedByUserId));
  return { ...meeting, team, initiatedBy };
}

/**
 * Get user's meetings (based on team membership)
 */
export async function getUserMeetings(userId: number): Promise<any[]> {
  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  if (!membership) return [];

  const meetings = await db.select().from(meetingsTable).where(eq(meetingsTable.teamId, membership.teamId));
  return Promise.all(meetings.map(formatMeeting));
}

/**
 * Get all meetings (coordinator view)
 */
export async function getAllMeetings(): Promise<any[]> {
  const meetings = await db.select().from(meetingsTable);
  return Promise.all(meetings.map(formatMeeting));
}

// ============ Meeting Operations ============

/**
 * Create meeting request
 */
export async function createMeetingRequest(
  teamId: number,
  initiatorId: number,
  data: { dateTime: string; title?: string; description?: string },
): Promise<any> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) throw new Error("Team not found");

  const [meeting] = await db
    .insert(meetingsTable)
    .values({
      teamId,
      initiatedByUserId: initiatorId,
      dateTime: new Date(data.dateTime),
      title: data.title,
      description: data.description,
      status: "pending",
    })
    .returning();

  // Notify team members
  if (team.supervisorId) {
    await createNotification(team.supervisorId, "meeting_request", `Meeting requested for team "${team.name}"`);
  }

  await logActivity("meeting_request_created", `Meeting request created for team "${team.name}"`, initiatorId, teamId);

  return formatMeeting(meeting);
}

/**
 * Approve meeting
 */
export async function approveMeeting(meetingId: number, approvedBy: number): Promise<any> {
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (!meeting) throw new Error("Meeting not found");

  const [updated] = await db.update(meetingsTable).set({ status: "approved", approvedBy, approvedAt: new Date() }).where(eq(meetingsTable.id, meetingId)).returning();

  await createNotification(meeting.initiatedByUserId, "meeting_approved", "Your meeting request has been approved");

  await logActivity("meeting_approved", `Meeting approved`, approvedBy, meeting.teamId);

  return formatMeeting(updated);
}

/**
 * Reject meeting
 */
export async function rejectMeeting(meetingId: number, rejectedBy: number, reason?: string): Promise<any> {
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (!meeting) throw new Error("Meeting not found");

  const [updated] = await db.update(meetingsTable).set({ status: "rejected", rejectedBy, rejectedAt: new Date(), rejectionReason: reason }).where(eq(meetingsTable.id, meetingId)).returning();

  await createNotification(meeting.initiatedByUserId, "meeting_rejected", `Your meeting request has been declined${reason ? `: ${reason}` : ""}`);

  await logActivity("meeting_rejected", `Meeting rejected`, rejectedBy, meeting.teamId);

  return formatMeeting(updated);
}
