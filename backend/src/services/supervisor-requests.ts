import { db, supervisorRequestsTable, teamsTable, usersTable, teamMembersTable, tasksTable } from "@workspace/db";
import { eq, and, sql, or } from "@workspace/db";
import { createNotification, logActivity } from "../lib/notify";

// ============ Formatting ============

/**
 * Format supervisor request with team, supervisor, and leader details
 */
export async function formatRequest(req_: typeof supervisorRequestsTable.$inferSelect) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, req_.teamId));
  const [supervisor] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, req_.supervisorId));
  const [leader] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, team.leaderId));
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, team.id));

  return { ...req_, team: { ...team, leader, supervisor: null, memberCount: countResult?.count ?? 0 }, supervisor };
}

// ============ Queries ============

/**
 * Get supervisor requests (role-based)
 */
export async function getSupervisorRequests(userId: number, userRole: string): Promise<any[]> {
  let requests: (typeof supervisorRequestsTable.$inferSelect)[];

  if (userRole === "supervisor") {
    requests = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.supervisorId, userId));
  } else if (userRole === "student") {
    const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
    if (!membership) {
      return [];
    }
    requests = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.teamId, membership.teamId));
  } else {
    // coordinator view - all requests
    requests = await db.select().from(supervisorRequestsTable);
  }

  return Promise.all(requests.map(formatRequest));
}

// ============ Request Operations ============

/**
 * Validate team leader can send supervisor request
 */
export async function validateCanSendRequest(userId: number, teamId: number, supervisorId: number): Promise<{ valid: boolean; error?: string }> {
  // Check if user is team leader
  const [membership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.userId, userId), eq(teamMembersTable.role, "leader")));
  if (!membership) {
    return { valid: false, error: "Only team leaders can send supervision requests" };
  }

  if (membership.teamId !== teamId) {
    return { valid: false, error: "You are not a leader of this team" };
  }

  // Check if team already has supervisor
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (team?.supervisorId) {
    return { valid: false, error: "Team already has a supervisor" };
  }

  // Check if pending request already exists
  const [existing] = await db
    .select()
    .from(supervisorRequestsTable)
    .where(and(eq(supervisorRequestsTable.teamId, teamId), eq(supervisorRequestsTable.supervisorId, supervisorId), eq(supervisorRequestsTable.status, "pending")));
  if (existing) {
    return { valid: false, error: "Request already sent" };
  }

  return { valid: true };
}

/**
 * Create supervisor request from team leader
 */
export async function createSupervisorRequest(teamId: number, supervisorId: number, userId: number, message: string): Promise<any> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  const [request] = await db
    .insert(supervisorRequestsTable)
    .values({ teamId, supervisorId, message, status: "pending" })
    .returning();

  await createNotification(supervisorId, "supervision_request", `Team "${team.name}" is requesting your supervision`, request.id, "supervisor_request");
  await logActivity("supervisor_request_sent", `Team "${team.name}" requested supervisor`, userId, teamId);

  return formatRequest(request);
}

/**
 * Validate request can be accepted/rejected
 */
export async function validateRequestExists(requestId: number, supervisorId: number): Promise<{ valid: boolean; error?: string; request?: typeof supervisorRequestsTable.$inferSelect }> {
  const [request] = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.id, requestId));
  if (!request || request.supervisorId !== supervisorId) {
    return { valid: false, error: "Request not found" };
  }
  if (request.status !== "pending") {
    return { valid: false, error: "Request already responded to" };
  }
  return { valid: true, request };
}

/**
 * Accept supervisor request - updates team and notifies members
 */
export async function acceptSupervisorRequestImpl(requestId: number, supervisorId: number): Promise<any> {
  const [request] = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.id, requestId));
  if (!request) {
    throw new Error("Request not found");
  }

  // Update request and team
  await db.update(supervisorRequestsTable).set({ status: "accepted" }).where(eq(supervisorRequestsTable.id, requestId));
  await db.update(teamsTable).set({ supervisorId: supervisorId, status: "supervised" }).where(eq(teamsTable.id, request.teamId));

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, request.teamId));
  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, request.teamId));

  for (const m of members) {
    await createNotification(m.userId, "supervisor_assigned", `Your supervisor request has been accepted by ${supervisorId}`);
  }

  await logActivity("supervisor_accepted", `Supervisor accepted supervision of team "${team?.name}"`, supervisorId, request.teamId);

  const [updated] = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.id, requestId));
  return formatRequest(updated);
}

/**
 * Reject supervisor request - notifies team leader
 */
export async function rejectSupervisorRequestImpl(requestId: number, supervisorId: number): Promise<any> {
  const [request] = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.id, requestId));
  if (!request) {
    throw new Error("Request not found");
  }

  await db.update(supervisorRequestsTable).set({ status: "rejected" }).where(eq(supervisorRequestsTable.id, requestId));

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, request.teamId));
  const [leader] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, request.teamId), eq(teamMembersTable.role, "leader")));

  if (leader) {
    await createNotification(leader.userId, "supervisor_rejected", `Your supervision request was rejected by ${supervisorId}`);
  }

  return { message: "Request rejected" };
}

/**
 * Clear supervisor from team - removes supervisor and notifies members
 */
export async function clearTeamSupervisor(teamId: number): Promise<{ team?: any; supervisor?: any; error?: string }> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    return { error: "Team not found" };
  }
  if (!team.supervisorId) {
    return { error: "Team does not have a supervisor assigned" };
  }

  const [supervisor] = await db.select().from(usersTable).where(eq(usersTable.id, team.supervisorId));

  // Assign supervisor to tasks that don't have one
  const teamTasks = await db.select().from(tasksTable).where(eq(tasksTable.teamId, teamId));
  for (const task of teamTasks) {
    if (task.supervisorId == null) {
      await db.update(tasksTable).set({ supervisorId: team.supervisorId }).where(eq(tasksTable.id, task.id));
    }
  }

  // Remove supervisor from team
  await db.update(teamsTable).set({ supervisorId: null, status: "active" }).where(eq(teamsTable.id, teamId));

  // Notify members
  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  for (const member of members) {
    await createNotification(member.userId, "supervisor_unassigned", `Supervisor ${supervisor?.name || "unknown"} has been removed from your team`);
  }

  return { team, supervisor };
}

/**
 * Coordinator assigns supervisor to team directly
 */
export async function coordinatorAssignSupervisor(teamId: number, supervisorId: number, coordinatorId: number): Promise<{ message: string }> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  const [supervisor] = await db.select().from(usersTable).where(and(eq(usersTable.id, supervisorId), eq(usersTable.role, "supervisor")));
  if (!supervisor) {
    throw new Error("Supervisor not found");
  }

  if (team.supervisorId) {
    throw new Error("Team already has a supervisor");
  }

  const [existingPending] = await db
    .select()
    .from(supervisorRequestsTable)
    .where(and(eq(supervisorRequestsTable.teamId, teamId), eq(supervisorRequestsTable.status, "pending")));
  if (existingPending) {
    throw new Error("This team already has a pending supervisor request");
  }

  const [request] = await db
    .insert(supervisorRequestsTable)
    .values({
      teamId,
      supervisorId,
      status: "pending",
      message: `Coordinator requested you to supervise team "${team.name}"`,
    })
    .returning();

  await createNotification(supervisorId, "supervision_request", `Coordinator requested you to supervise team "${team.name}". Please accept or reject.`, request.id, "supervisor_request");
  await logActivity("supervisor_request_sent_by_coordinator", `Coordinator sent supervision request to ${supervisor.name} for team "${team.name}"`, coordinatorId, teamId);

  return { message: "Supervisor request sent successfully" };
}

/**
 * Validate supervisor can unassign themselves
 */
export async function validateSupervisorCanUnassign(teamId: number, supervisorId: number): Promise<{ valid: boolean; error?: string }> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    return { valid: false, error: "Team not found" };
  }
  if (team.supervisorId !== supervisorId) {
    return { valid: false, error: "You are not supervising this team" };
  }
  return { valid: true };
}

/**
 * Get user's team membership (leader role)
 */
export async function getUserTeamLeadershipOrNull(userId: number): Promise<number | null> {
  const [membership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.userId, userId), eq(teamMembersTable.role, "leader")));
  return membership?.teamId ?? null;
}
