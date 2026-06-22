import { db, teamsTable, projectPhasesTable, teamMembersTable } from "@workspace/db";
import { eq, and } from "@workspace/db";
import { logActivity, createNotification } from "../lib/notify";

// ============ Constants ============

export const PHASE_ORDER: ("proposal" | "progress" | "final")[] = ["proposal", "progress", "final"];

// ============ Formatting ============

/**
 * Format phase with team details
 */
export async function formatPhase(phase: typeof projectPhasesTable.$inferSelect) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, phase.teamId));
  return { ...phase, team };
}

// ============ Phase Queries ============

/**
 * Get all phases
 */
export async function getAllPhases() {
  const phases = await db.select().from(projectPhasesTable);
  return Promise.all(phases.map(formatPhase));
}

/**
 * Get active phase for team
 */
export async function getActivePhaseForTeam(teamId: number) {
  const [phase] = await db.select().from(projectPhasesTable).where(and(eq(projectPhasesTable.teamId, teamId), eq(projectPhasesTable.status, "in_progress")));
  if (!phase) {
    throw new Error("No active phase found");
  }
  return formatPhase(phase);
}

// ============ Phase Operations ============

/**
 * Advance team to next phase
 */
export async function advanceTeamPhase(teamId: number, userId: number, userRole: string) {
  // Check permissions
  if (userRole !== "supervisor" && userRole !== "coordinator") {
    throw new Error("Only supervisors and coordinators can advance phases");
  }

  // Get team
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  // Determine next phase
  const currentPhaseIndex = team.currentPhase ? PHASE_ORDER.indexOf(team.currentPhase) : -1;
  const nextIndex = currentPhaseIndex + 1;
  if (nextIndex >= PHASE_ORDER.length) {
    throw new Error("Team is already in the final phase");
  }

  const nextPhase = PHASE_ORDER[nextIndex];

  // Mark current phase as completed
  if (team.currentPhase) {
    await db.update(projectPhasesTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(eq(projectPhasesTable.teamId, teamId), eq(projectPhasesTable.phase, team.currentPhase)));
  }

  // Create new phase record
  const [newPhase] = await db.insert(projectPhasesTable).values({
    teamId,
    phase: nextPhase,
    status: "in_progress",
  }).returning();

  // Update team's current phase
  await db.update(teamsTable).set({ currentPhase: nextPhase }).where(eq(teamsTable.id, teamId));

  // Notify team members
  const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
  for (const m of members) {
    await createNotification(m.userId, "phase_advanced", `Your project phase has advanced to "${nextPhase}"`);
  }

  // Log activity
  await logActivity("phase_advanced", `Team "${team.name}" advanced to ${nextPhase} phase`, userId, teamId);

  return formatPhase(newPhase);
}
