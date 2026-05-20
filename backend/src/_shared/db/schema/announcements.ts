import { z } from "zod/v4";
import { defineTable } from "./_core";

export type TeamAnnouncement = {
  id: number;
  title: string;
  description: string | null;
  leaderId: number | null;
  teamId: number | null;
  createdAt: Date;
};

export const teamAnnouncementsTable = defineTable<TeamAnnouncement>("team_announcements", [
  "id",
  "title",
  "description",
  "leaderId",
  "teamId",
  "createdAt",
]);

export const insertTeamAnnouncementSchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  leaderId: z.number().nullable().optional(),
  teamId: z.number().nullable().optional(),
});

export type InsertTeamAnnouncement = z.infer<typeof insertTeamAnnouncementSchema>;
