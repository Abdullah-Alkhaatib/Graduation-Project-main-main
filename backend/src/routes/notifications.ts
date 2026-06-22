import { Router } from "express";
import type { IRouter } from "express";
import { requireAuth } from "../lib/session";
import { getUserNotifications, markAllNotificationsAsRead, markNotificationAsRead } from "../services/notifications";

const router: IRouter = Router();

function handleServiceError(res: any, error: unknown) {
  if (error instanceof Error) {
    const message = error.message || "Internal server error";
    res.status(400).json({ error: message });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Internal server error" });
}

/**
 * GET /notifications
 * Get all user notifications sorted by date (newest first)
 */
router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  try {
    const notifications = await getUserNotifications(req.user!.id);
    res.json(notifications);
  } catch (error) {
    handleServiceError(res, error);
  }
});

/**
 * POST /notifications/read-all
 * Mark all notifications as read
 */
router.post("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  try {
    await markAllNotificationsAsRead(req.user!.id);
    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    handleServiceError(res, error);
  }
});

/**
 * POST /notifications/:id/read
 * Mark a single notification as read
 */
router.post("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    await markNotificationAsRead(id, req.user!.id);
    res.json({ message: "Notification marked as read" });
  } catch (error) {
    handleServiceError(res, error);
  }
});

export default router;

