import { z } from "zod/v4";
import { defineTable } from "./_core";

export type StudentProfile = {
  id: number;
  userId: number;
  studentId: string | null;
  gpa: number | null;
  skills: string | null;
  interests: string | null;
  description: string | null;
  updatedAt: Date;
};

export const studentProfilesTable = defineTable<StudentProfile>("student_profiles", [
  "id",
  "userId",
  "studentId",
  "gpa",
  "skills",
  "interests",
  "description",
  "updatedAt",
]);

export const insertStudentProfileSchema = z.object({
  userId: z.number(),
  studentId: z.string().length(6).optional().nullable(),
  gpa: z.number().nullable().optional(),
  skills: z.string().nullable().optional(),
  interests: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type InsertStudentProfile = z.infer<typeof insertStudentProfileSchema>;

