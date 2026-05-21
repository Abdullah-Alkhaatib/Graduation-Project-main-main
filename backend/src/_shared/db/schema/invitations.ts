import { z } from "zod/v4";
import { defineTable } from "./_core";

export type Invitation = {
  id: number;
  teamId: number;
  invitedUserId: number;
  invitedByUserId: number;
  status: "pending" | "accepted" | "rejected";
  requiresTeamApproval: boolean | null;
  approvalForInvitationId: number | null;
  approvalTargetUserId: number | null;
  teamApproved: boolean | null;
  createdAt: Date;
};

export const invitationsTable = defineTable<Invitation>("invitations", [
  "id",
  "teamId",
  "invitedUserId",
  "invitedByUserId",
  "status",
  "requiresTeamApproval",
  "approvalForInvitationId",
  "approvalTargetUserId",
  "teamApproved",
  "createdAt",
]);

export const insertInvitationSchema = z.object({
  teamId: z.number(),
  invitedUserId: z.number(),
  invitedByUserId: z.number(),
  status: z.enum(["pending", "accepted", "rejected"]).optional(),
  requiresTeamApproval: z.boolean().nullable().optional(),
  approvalForInvitationId: z.number().nullable().optional(),
  approvalTargetUserId: z.number().nullable().optional(),
  teamApproved: z.boolean().nullable().optional(),
});
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;

