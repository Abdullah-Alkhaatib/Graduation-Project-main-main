import { z } from "zod/v4";
import { defineTable } from "./_core";

export type SupervisorRequest = {
  id: number;
  teamId: number;
  supervisorId: number;
  status: "pending" | "accepted" | "rejected";
  message: string | null;
  createdAt: Date;
};

export const supervisorRequestsTable = defineTable<SupervisorRequest>("supervisor_requests", [
  "id",
  "teamId",
  "supervisorId",
  "status",
  "message",
  "createdAt",
]);

export const insertSupervisorRequestSchema = z.object({
  teamId: z.number(),
  supervisorId: z.number(),
  status: z.enum(["pending", "accepted", "rejected"]).optional(),
  message: z.string().nullable().optional(),
});
export type InsertSupervisorRequest = z.infer<typeof insertSupervisorRequestSchema>;

