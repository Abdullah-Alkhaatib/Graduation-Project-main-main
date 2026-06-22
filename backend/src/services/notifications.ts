import { db, notificationsTable } from "@workspace/db";
import { eq } from "@workspace/db";

// ============ Queries ============

/**
 * Get all notifications for user, sorted by newest first
 */
export async function getUserNotifications(userId: number): Promise<any[]> {
  const notifications = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, userId));
  return notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Get unread notification count for user
 */
export async function getUnreadCount(userId: number): Promise<number> {
  const notifications = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, userId));
  return notifications.filter((n) => !n.isRead).length;
}

// ============ Modifications ============

/**
 * Mark notification as read
 */
export async function markAsRead(notificationId: number, userId: number): Promise<void> {
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.id, notificationId));
}

/**
 * Mark all notifications as read for user
 */
export async function markAllAsRead(userId: number): Promise<void> {
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, userId));
}

/**
 * Delete notification
 */
export async function deleteNotification(notificationId: number): Promise<void> {
  await db.delete(notificationsTable).where(eq(notificationsTable.id, notificationId));
}

/**
 * Delete all notifications for user
 */
export async function deleteAllNotifications(userId: number): Promise<void> {
  await db.delete(notificationsTable).where(eq(notificationsTable.userId, userId));
}
