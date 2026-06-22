import { db, supervisorRequestsTable, teamsTable, usersTable } from "@workspace/db";
import { eq, and } from "@workspace/db";
import { createNotification, logActivity } from "../lib/notify";

// ============ Queries ============

/**
 * Get supervisor requests with team and supervisor details
 */
export async function formatRequest(request: any): Promise<any> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, request.teamId));
  const [supervisor] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, request.supervisorId));
  const [requestedBy] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, request.requestedByUserId));
  return { ...request, team, supervisor, requestedBy };
}

/**
 * Get supervisor requests for team
 */
export async function getTeamRequests(teamId: number): Promise<any[]> {
  const requests = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.teamId, teamId));
  return Promise.all(requests.map(formatRequest));
}

/**
 * Get pending supervisor requests for supervisor
 */
export async function getSupervisorPendingRequests(supervisorId: number): Promise<any[]> {
  const requests = await db.select().from(supervisorRequestsTable).where(and(eq(supervisorRequestsTable.supervisorId, supervisorId), eq(supervisorRequestsTable.status, "pending")));
  return Promise.all(requests.map(formatRequest));
}

/**
 * Get all supervisor requests (coordinator view)
 */
export async function getAllRequests(): Promise<any[]> {
  const requests = await db.select().from(supervisorRequestsTable);
  return Promise.all(requests.map(formatRequest));
}

// ============ Request Operations ============

/**
 * Send supervisor request
 */
export async function sendSupervisorRequest(teamId: number, supervisorId: number, requestedById: number): Promise<any> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) throw new Error("Team not found");

  const [supervisor] = await db.select().from(usersTable).where(eq(usersTable.id, supervisorId));
  if (!supervisor) throw new Error("Supervisor not found");

  const [request] = await db
    .insert(supervisorRequestsTable)
    .values({
      teamId,
      supervisorId,
      requestedByUserId: requestedById,
      status: "pending",
    })
    .returning();

  await createNotification(supervisorId, "supervisor_request", `Team "${team.name}" requested you as supervisor`);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, requestedById));
  await logActivity("supervisor_request_sent", `Supervisor request sent to ${supervisor.name}`, requestedById, teamId);

  return formatRequest(request);
}

/**
 * Accept supervisor request
 */
export async function acceptSupervisorRequest(requestId: number, acceptedBy: number): Promise<any> {
  const [request] = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.id, requestId));
  if (!request) throw new Error("Request not found");

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, request.teamId));
  if (!team) throw new Error("Team not found");

  // Assign supervisor to team
  await db.update(teamsTable).set({ supervisorId: request.supervisorId }).where(eq(teamsTable.id, request.teamId));

  // Update request status
  const [updated] = await db
    .update(supervisorRequestsTable)
    .set({ status: "accepted", respondedAt: new Date(), respondedBy: acceptedBy })
    .where(eq(supervisorRequestsTable.id, requestId))
    .returning();

  await createNotification(request.requestedByUserId, "supervisor_assigned", `${request.supervisorId} accepted to supervise your team "${team.name}"`);

  await logActivity("supervisor_request_accepted", `Accepted supervision for team "${team.name}"`, acceptedBy, request.teamId);

  return formatRequest(updated);
}

/**
 * Reject supervisor request
 */
export async function rejectSupervisorRequest(requestId: number, rejectedBy: number, reason?: string): Promise<any> {
  const [request] = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.id, requestId));
  if (!request) throw new Error("Request not found");

  const [updated] = await db
    .update(supervisorRequestsTable)
    .set({ status: "rejected", respondedAt: new Date(), respondedBy: rejectedBy, rejectionReason: reason })
    .where(eq(supervisorRequestsTable.id, requestId))
    .returning();

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, request.teamId));
  await createNotification(request.requestedByUserId, "supervisor_rejected", `Supervision request for team "${team?.name}" was declined${reason ? `: ${reason}` : ""}`);

  await logActivity("supervisor_request_rejected", `Rejected supervision for team "${team?.name}"`, rejectedBy, request.teamId);

  return formatRequest(updated);
}
