import { z } from "zod/v4";
import { defineTable } from "./_core";

export type User = {
  id: number;
  name: string;
  email: string;
  studentId?: string | null;
  gender?: "Male" | "Female" | null;
  passwordHash: string;
  role: "student" | "supervisor" | "coordinator";
  officeHours: string | null;
  createdAt: Date;
};

export const usersTable = defineTable<User>("users", [
  "id",
  "studentId",
  "gender",
  "name",
  "email",
  "passwordHash",
  "role",
  "officeHours",
  "createdAt",
],);

export const insertUserSchema = z.object({
  name: z.string(),
  email: z.string(),
  studentId: z.string().optional().nullable(),
  gender: z.enum(["Male", "Female"]).nullish(),
  passwordHash: z.string(),
  role: z.enum(["student", "supervisor", "coordinator"]),
});
export type InsertUser = z.infer<typeof insertUserSchema>;

