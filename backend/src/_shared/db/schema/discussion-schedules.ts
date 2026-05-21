import { z } from "zod/v4";
import { defineTable } from "./_core";

export type DiscussionSchedule = {
  id: number;
  teamId: number;
  supervisorId: number;
  examiner1Id: number;
  examiner2Id: number;
  room: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "scheduled" | "cancelled" | "completed";
  createdAt: Date;
  updatedAt: Date;
};

export const discussionSchedulesTable = defineTable<DiscussionSchedule>("discussion_schedules", [
  "id",
  "teamId",
  "supervisorId",
  "examiner1Id",
  "examiner2Id",
  "room",
  "date",
  "startTime",
  "endTime",
  "status",
  "createdAt",
  "updatedAt",
]);

export const insertDiscussionScheduleSchema = z.object({
  teamId: z.number(),
  supervisorId: z.number(),
  examiner1Id: z.number(),
  examiner2Id: z.number(),
  room: z.string(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  status: z.enum(["scheduled", "cancelled", "completed"]).optional(),
});

export type InsertDiscussionSchedule = z.infer<typeof insertDiscussionScheduleSchema>;
