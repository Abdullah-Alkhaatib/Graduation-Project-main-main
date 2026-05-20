import { db, notificationsTable, activityLogsTable } from "@workspace/db";

export async function createNotification(
  userId: number,
  type: string,
  message: string,
  relatedId?: number,
  relatedType?: string
) {
  await db.insert(notificationsTable).values({
    userId,
    type,
    message,
    isRead: false,
    relatedId,
    relatedType,
  });
}

export async function logActivity(
  action: string,
  description: string,
  userId?: number,
  teamId?: number
) {
  await db.insert(activityLogsTable).values({
    action,
    description,
    userId,
    teamId,
  });
}
