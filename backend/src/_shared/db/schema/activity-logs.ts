import { z } from "zod/v4";
import { defineTable } from "./_core";

export type ActivityLog = {
  id: number;
  userId: number | null;
  teamId: number | null;
  action: string;
  description: string;
  createdAt: Date;
};

export const activityLogsTable = defineTable<ActivityLog>("activity_logs", [
  "id",
  "userId",
  "teamId",
  "action",
  "description",
  "createdAt",
]);

export const insertActivityLogSchema = z.object({
  userId: z.number().nullable().optional(),
  teamId: z.number().nullable().optional(),
  action: z.string(),
  description: z.string(),
});
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;

