import { z } from "zod/v4";
import { defineTable } from "./_core";

export type Invitation = {
  id: number;
  teamId: number;
  invitedUserId: number;
  invitedByUserId: number;
  status: "pending" | "accepted" | "rejected";
  createdAt: Date;
};

export const invitationsTable = defineTable<Invitation>("invitations", [
  "id",
  "teamId",
  "invitedUserId",
  "invitedByUserId",
  "status",
  "createdAt",
]);

export const insertInvitationSchema = z.object({
  teamId: z.number(),
  invitedUserId: z.number(),
  invitedByUserId: z.number(),
  status: z.enum(["pending", "accepted", "rejected"]).optional(),
});
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;

