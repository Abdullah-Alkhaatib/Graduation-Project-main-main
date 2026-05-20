import { z } from "zod/v4";
import { defineTable } from "./_core";

export type Team = {
  id: number;
  name: string;
  projectTitle: string | null;
  description: string | null;
  status: "forming" | "active" | "supervised" | "completed";
  leaderId: number;
  supervisorId: number | null;
  currentPhase: "proposal" | "progress" | "final" | null;
  createdAt: Date;
};

export const teamsTable = defineTable<Team>("teams", [
  "id",
  "name",
  "projectTitle",
  "description",
  "status",
  "leaderId",
  "supervisorId",
  "currentPhase",
  "createdAt",
]);

export const insertTeamSchema = z.object({
  name: z.string(),
  projectTitle: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["forming", "active", "supervised", "completed"]).optional(),
  leaderId: z.number(),
  supervisorId: z.number().nullable().optional(),
  currentPhase: z.enum(["proposal", "progress", "final"]).nullable().optional(),
});
export type InsertTeam = z.infer<typeof insertTeamSchema>;

export type TeamMember = {
  id: number;
  teamId: number;
  userId: number;
  role: "leader" | "member";
  joinedAt: Date;
};

export const teamMembersTable = defineTable<TeamMember>("team_members", [
  "id",
  "teamId",
  "userId",
  "role",
  "joinedAt",
]);

export const insertTeamMemberSchema = z.object({
  teamId: z.number(),
  userId: z.number(),
  role: z.enum(["leader", "member"]).optional(),
});
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;

