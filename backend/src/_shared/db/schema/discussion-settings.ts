import { z } from "zod/v4";
import { defineTable } from "./_core";

export type DiscussionSettings = {
  id: number;
  startDate: string;
  endDate: string;
  workStartHour: string;
  workEndHour: string;
  discussionDuration: number;
  breakDuration: number;
  roomsCount: number;
  includedTeamIds: number[] | null;
  createdAt: Date;
  updatedAt: Date;
};

export const discussionSettingsTable = defineTable<DiscussionSettings>("discussion_settings", [
  "id",
  "startDate",
  "endDate",
  "workStartHour",
  "workEndHour",
  "discussionDuration",
  "breakDuration",
  "roomsCount",
  "includedTeamIds",
  "createdAt",
  "updatedAt",
]);

export const insertDiscussionSettingsSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  workStartHour: z.string(),
  workEndHour: z.string(),
  discussionDuration: z.number().int().positive(),
  breakDuration: z.number().int().min(0),
  roomsCount: z.number().int().min(1),
  includedTeamIds: z.array(z.number()).nullable().optional(),
});

export type InsertDiscussionSettings = z.infer<typeof insertDiscussionSettingsSchema>;
