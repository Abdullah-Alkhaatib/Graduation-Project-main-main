import { z } from "zod/v4";
import { defineTable } from "./_core";

export type Meeting = {
  id: number;
  teamId: number;
  requestedById: number;
  supervisorId: number;
  proposedDate: Date;
  status: "pending" | "approved" | "rejected";
  notes: string | null;
  createdAt: Date;
};

export const meetingsTable = defineTable<Meeting>("meetings", [
  "id",
  "teamId",
  "requestedById",
  "supervisorId",
  "proposedDate",
  "status",
  "notes",
  "createdAt",
]);

export const insertMeetingSchema = z.object({
  teamId: z.number(),
  requestedById: z.number(),
  supervisorId: z.number(),
  proposedDate: z.date(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  notes: z.string().nullable().optional(),
});
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;

