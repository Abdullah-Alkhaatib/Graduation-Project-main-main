import { z } from "zod/v4";
import { defineTable } from "./_core";

export type ProjectPhase = {
  id: number;
  teamId: number;
  phase: "proposal" | "progress" | "final";
  status: "in_progress" | "completed";
  startedAt: Date;
  completedAt: Date | null;
};

export const projectPhasesTable = defineTable<ProjectPhase>("project_phases", [
  "id",
  "teamId",
  "phase",
  "status",
  "startedAt",
  "completedAt",
]);

export const insertProjectPhaseSchema = z.object({
  teamId: z.number(),
  phase: z.enum(["proposal", "progress", "final"]),
  status: z.enum(["in_progress", "completed"]).optional(),
  completedAt: z.date().nullable().optional(),
});
export type InsertProjectPhase = z.infer<typeof insertProjectPhaseSchema>;

