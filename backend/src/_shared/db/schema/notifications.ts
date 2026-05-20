import { z } from "zod/v4";
import { defineTable } from "./_core";

export type Notification = {
  id: number;
  userId: number;
  type: string;
  message: string;
  isRead: boolean;
  relatedId: number | null;
  relatedType: string | null;
  createdAt: Date;
};

export const notificationsTable = defineTable<Notification>("notifications", [
  "id",
  "userId",
  "type",
  "message",
  "isRead",
  "relatedId",
  "relatedType",
  "createdAt",
]);

export const insertNotificationSchema = z.object({
  userId: z.number(),
  type: z.string(),
  message: z.string(),
  isRead: z.boolean().optional(),
  relatedId: z.number().nullable().optional(),
  relatedType: z.string().nullable().optional(),
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

