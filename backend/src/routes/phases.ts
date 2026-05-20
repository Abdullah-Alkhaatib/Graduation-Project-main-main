import { Router } from "express";
import type { IRouter } from "express";
import { db, teamsTable, projectPhasesTable, teamMembersTable } from "@workspace/db";
import { eq, and } from "@workspace/db";
import { requireAuth } from "../lib/session";
import { logActivity, createNotification } from "../lib/notify";

const router: IRouter = Router();

const PHASE_ORDER: ("proposal" | "progress" | "final")[] = ["proposal", "progress", "final"];

async function getTeamFormatted(teamId: number) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  return team;
}

async function formatPhase(phase: typeof projectPhasesTable.$inferSelect) {
  const team = await getTeamFormatted(phase.teamId);
  return { ...phase, team };
}

router.get("/phases", requireAuth, async (req, res): Promise<void> => {
  const phases = await db.select().from(projectPhasesTable);
  const formatted = await Promise.all(phases.map(formatPhase));
  res.json(formatted);
});

router.get("/phases/:teamId", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.teamId) ? req.params.teamId[0] : req.params.teamId;
  const teamId = parseInt(raw, 10);
  if (isNaN(teamId)) { res.status(400).json({ error: "Invalid teamId" }); return; }

  const [phase] = await db.select().from(projectPhasesTable).where(and(eq(projectPhasesTable.teamId, teamId), eq(projectPhasesTable.status, "in_progress")));
  if (!phase) { res.status(404).json({ error: "No active phase found" }); return; }
  res.json(await formatPhase(phase));
});

router.post("/phases/:teamId/advance", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.teamId) ? req.params.teamId[0] : req.params.teamId;
  const teamId = parseInt(raw, 10);
  if (isNaN(teamId)) { res.status(400).json({ error: "Invalid teamId" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  if (req.user!.role !== "supervisor" && req.user!.role !== "coordinator") {
    res.status(403).json({ error: "Only supervisors and coordinators can advance phases" }); return;
  }

  const currentPhaseIndex = team.currentPhase ? PHASE_ORDER.indexOf(team.currentPhase) : -1;
  const nextIndex = currentPhaseIndex + 1;
  if (nextIndex >= PHASE_ORDER.length) { res.status(400).json({ error: "Team is already in the final phase" }); return; }

  const nextPhase = PHASE_ORDER[nextIndex];

  if (team.currentPhase) {
    await db.update(projectPhasesTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(eq(projectPhasesTable.teamId, teamId), eq(projectPhasesTable.phase, team.currentPhase)));
  }

  const [newPhase] = await db.insert(projectPhasesTable).values({ teamId, phase: nextPhase, status: "in_progress" }).returning();
  await db.update(teamsTable).set({ currentPhase: nextPhase }).where(eq(teamsTable.id, teamId));

  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  for (const m of members) {
    await createNotification(m.userId, "phase_advanced", `Your project phase has advanced to "${nextPhase}"`);
  }
  await logActivity("phase_advanced", `Team "${team.name}" advanced to ${nextPhase} phase`, req.user!.id, teamId);

  res.json(await formatPhase(newPhase));
});

export default router;

