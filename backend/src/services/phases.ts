import { db, phasesTable, teamsTable, usersTable } from "@workspace/db";
import { eq } from "@workspace/db";
import { logActivity } from "../lib/notify";

// ============ Phase Types ============

export type Phase = "proposal" | "progress" | "final";
export type PhaseStatus = "pending" | "submitted" | "approved" | "rejected";

// ============ Queries ============

/**
 * Get phases for team
 */
export async function getTeamPhases(teamId: number): Promise<any[]> {
  const phases = await db.select().from(phasesTable).where(eq(phasesTable.teamId, teamId));

  return Promise.all(
    phases.map(async (phase) => {
      const [reviewer] = phase.reviewedBy ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, phase.reviewedBy)) : [null];
      return { ...phase, reviewer };
    }),
  );
}

/**
 * Get phase by ID
 */
export async function getPhaseById(phaseId: number): Promise<any | null> {
  const [phase] = await db.select().from(phasesTable).where(eq(phasesTable.id, phaseId));
  if (!phase) return null;

  const [reviewer] = phase.reviewedBy ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, phase.reviewedBy)) : [null];
  return { ...phase, reviewer };
}

// ============ Phase Operations ============

/**
 * Submit phase
 */
export async function submitPhase(phaseId: number, submittedBy: number, submissionData?: any): Promise<any> {
  const [phase] = await db.select().from(phasesTable).where(eq(phasesTable.id, phaseId));
  if (!phase) throw new Error("Phase not found");

  const [updated] = await db
    .update(phasesTable)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      submittedBy,
      submissionData: submissionData ? JSON.stringify(submissionData) : null,
    })
    .where(eq(phasesTable.id, phaseId))
    .returning();

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, phase.teamId));
  await logActivity("phase_submitted", `${phase.phase} phase submitted for team "${team?.name}"`, submittedBy, phase.teamId);

  return getPhaseById(phaseId);
}

/**
 * Approve phase
 */
export async function approvePhase(phaseId: number, approvedBy: number, feedback?: string): Promise<any> {
  const [phase] = await db.select().from(phasesTable).where(eq(phasesTable.id, phaseId));
  if (!phase) throw new Error("Phase not found");

  const [updated] = await db
    .update(phasesTable)
    .set({
      status: "approved",
      reviewedAt: new Date(),
      reviewedBy: approvedBy,
      reviewFeedback: feedback,
    })
    .where(eq(phasesTable.id, phaseId))
    .returning();

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, phase.teamId));
  await logActivity("phase_approved", `${phase.phase} phase approved for team "${team?.name}"`, approvedBy, phase.teamId);

  return getPhaseById(phaseId);
}

/**
 * Reject phase
 */
export async function rejectPhase(phaseId: number, rejectedBy: number, feedback?: string): Promise<any> {
  const [phase] = await db.select().from(phasesTable).where(eq(phasesTable.id, phaseId));
  if (!phase) throw new Error("Phase not found");

  const [updated] = await db
    .update(phasesTable)
    .set({
      status: "rejected",
      reviewedAt: new Date(),
      reviewedBy: rejectedBy,
      reviewFeedback: feedback,
    })
    .where(eq(phasesTable.id, phaseId))
    .returning();

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, phase.teamId));
  await logActivity("phase_rejected", `${phase.phase} phase rejected for team "${team?.name}"`, rejectedBy, phase.teamId);

  return getPhaseById(phaseId);
}
