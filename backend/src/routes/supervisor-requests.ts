import { Router } from "express";
import type { IRouter } from "express";
import { db, usersTable, teamsTable, supervisorRequestsTable, teamMembersTable, tasksTable } from "@workspace/db";
import { eq, and, sql, or } from "@workspace/db";
import { requireAuth, requireRole } from "../lib/session";
import { createNotification, logActivity } from "../lib/notify";

const router: IRouter = Router();

async function clearTeamSupervisor(teamId: number) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    return { error: "Team not found" as const };
  }
  if (!team.supervisorId) {
    return { error: "Team does not have a supervisor assigned" as const };
  }

  const [supervisor] = await db.select().from(usersTable).where(eq(usersTable.id, team.supervisorId));

  const teamTasks = await db.select().from(tasksTable).where(eq(tasksTable.teamId, teamId));
  for (const task of teamTasks) {
    if (task.supervisorId == null) {
      await db.update(tasksTable)
        .set({ supervisorId: team.supervisorId })
        .where(eq(tasksTable.id, task.id));
    }
  }

  await db.update(teamsTable).set({ supervisorId: null, status: "active" }).where(eq(teamsTable.id, teamId));

  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  for (const member of members) {
    await createNotification(member.userId, "supervisor_unassigned", `Supervisor ${supervisor?.name || "unknown"} has been removed from your team`);
  }

  return { team, supervisor };
}

async function formatRequest(req_: typeof supervisorRequestsTable.$inferSelect) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, req_.teamId));
  const [supervisor] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, req_.supervisorId));
  const [leader] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, team.leaderId));
  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembersTable).where(eq(teamMembersTable.teamId, team.id));
  return { ...req_, team: { ...team, leader, supervisor: null, memberCount: countResult?.count ?? 0 }, supervisor };
}

router.get("/supervisor-requests", requireAuth, async (req, res): Promise<void> => {
  let requests: (typeof supervisorRequestsTable.$inferSelect)[];
  if (req.user!.role === "supervisor") {
    requests = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.supervisorId, req.user!.id));
  } else if (req.user!.role === "student") {
    const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, req.user!.id));
    if (!membership) { res.json([]); return; }
    requests = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.teamId, membership.teamId));
  } else {
    requests = await db.select().from(supervisorRequestsTable);
  }
  const formatted = await Promise.all(requests.map(formatRequest));
  res.json(formatted);
});

router.post("/supervisor-requests", requireAuth, requireRole("student"), async (req, res): Promise<void> => {
  const { supervisorId, message } = req.body;
  if (!supervisorId) { res.status(400).json({ error: "supervisorId required" }); return; }

  const [membership] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.userId, req.user!.id), eq(teamMembersTable.role, "leader")));
  if (!membership) { res.status(400).json({ error: "Only team leaders can send supervision requests" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
  if (team.supervisorId) { res.status(400).json({ error: "Team already has a supervisor" }); return; }

  const [existing] = await db.select().from(supervisorRequestsTable).where(and(eq(supervisorRequestsTable.teamId, membership.teamId), eq(supervisorRequestsTable.supervisorId, supervisorId), eq(supervisorRequestsTable.status, "pending")));
  if (existing) { res.status(400).json({ error: "Request already sent" }); return; }

  const [request] = await db.insert(supervisorRequestsTable).values({ teamId: membership.teamId, supervisorId, message, status: "pending" }).returning();
  await createNotification(supervisorId, "supervision_request", `Team "${team.name}" is requesting your supervision`, request.id, "supervisor_request");
  await logActivity("supervisor_request_sent", `Team "${team.name}" requested supervisor`, req.user!.id, membership.teamId);

  res.status(201).json(await formatRequest(request));
});

router.post("/supervisor-requests/:id/accept", requireAuth, requireRole("supervisor"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [request] = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.id, id));
  if (!request || request.supervisorId !== req.user!.id) { res.status(404).json({ error: "Request not found" }); return; }
  if (request.status !== "pending") { res.status(400).json({ error: "Request already responded to" }); return; }

  await db.update(supervisorRequestsTable).set({ status: "accepted" }).where(eq(supervisorRequestsTable.id, id));
  await db.update(teamsTable).set({ supervisorId: req.user!.id, status: "supervised" }).where(eq(teamsTable.id, request.teamId));

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, request.teamId));
  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, request.teamId));
  for (const m of members) {
    await createNotification(m.userId, "supervisor_assigned", `Your supervisor request has been accepted by ${req.user!.name}`);
  }
  await logActivity("supervisor_accepted", `${req.user!.name} accepted supervision of team "${team?.name}"`, req.user!.id, request.teamId);

  res.json({ message: "Request accepted" });
});

router.post("/supervisor-requests/:id/reject", requireAuth, requireRole("supervisor"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [request] = await db.select().from(supervisorRequestsTable).where(eq(supervisorRequestsTable.id, id));
  if (!request || request.supervisorId !== req.user!.id) { res.status(404).json({ error: "Request not found" }); return; }

  await db.update(supervisorRequestsTable).set({ status: "rejected" }).where(eq(supervisorRequestsTable.id, id));
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, request.teamId));
  const [leader] = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, request.teamId), eq(teamMembersTable.role, "leader")));
  if (leader) {
    await createNotification(leader.userId, "supervisor_rejected", `Your supervision request was rejected by ${req.user!.name}`);
  }

  res.json({ message: "Request rejected" });
});

router.post("/coordinator/assign-supervisor", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  const { teamId, supervisorId } = req.body;
  if (!teamId || !supervisorId) { res.status(400).json({ error: "teamId and supervisorId required" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  const [supervisor] = await db.select().from(usersTable).where(and(eq(usersTable.id, supervisorId), eq(usersTable.role, "supervisor")));
  if (!supervisor) { res.status(404).json({ error: "Supervisor not found" }); return; }

  await db.update(teamsTable).set({ supervisorId, status: "supervised" }).where(eq(teamsTable.id, teamId));
  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  for (const m of members) {
    await createNotification(m.userId, "supervisor_assigned", `Supervisor ${supervisor.name} has been assigned to your team`);
  }
  await logActivity("supervisor_assigned_by_coordinator", `Coordinator assigned ${supervisor.name} to team "${team.name}"`, req.user!.id, teamId);

  res.json({ message: "Supervisor assigned successfully" });
});

router.post("/coordinator/unassign-supervisor", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  const { teamId } = req.body;
  if (!teamId) { res.status(400).json({ error: "teamId required" }); return; }
  const result = await clearTeamSupervisor(teamId);
  if ("error" in result) { res.status(result.error === "Team not found" ? 404 : 400).json({ error: result.error }); return; }

  await logActivity("supervisor_unassigned_by_coordinator", `Coordinator removed ${result.supervisor?.name || "supervisor"} from team "${result.team.name}"`, req.user!.id, teamId);
  res.json({ message: "Supervisor removed successfully" });
});

router.post("/supervisor/unassign-supervisor", requireAuth, requireRole("supervisor"), async (req, res): Promise<void> => {
  const { teamId } = req.body;
  if (!teamId) { res.status(400).json({ error: "teamId required" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.supervisorId !== req.user!.id) { res.status(403).json({ error: "You are not supervising this team" }); return; }

  const result = await clearTeamSupervisor(teamId);
  if ("error" in result) { res.status(result.error === "Team not found" ? 404 : 400).json({ error: result.error }); return; }

  await logActivity("supervisor_unassigned_by_supervisor", `${req.user!.name} stopped supervising team "${result.team.name}"`, req.user!.id, teamId);
  res.json({ message: "You stopped supervising this team" });
});

export default router;

