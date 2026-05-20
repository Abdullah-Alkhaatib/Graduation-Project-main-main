import { z } from "zod/v4";
import { defineTable } from "./_core";

export type Submission = {
  id: number;
  taskId: number;
  submittedById: number;
  fileUrl: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  feedback: string | null;
  submittedAt: Date;
};

export const submissionsTable = defineTable<Submission>("submissions", [
  "id",
  "taskId",
  "submittedById",
  "fileUrl",
  "notes",
  "status",
  "feedback",
  "submittedAt",
]);

export const insertSubmissionSchema = z.object({
  taskId: z.number(),
  submittedById: z.number(),
  fileUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  feedback: z.string().nullable().optional(),
});
export type InsertSubmission = z.infer<typeof insertSubmissionSchema>;

