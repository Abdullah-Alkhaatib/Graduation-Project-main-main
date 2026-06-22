import { Router } from "express";
import type { IRouter } from "express";
import { requireAuth, requireRole } from "../middlewares/auth";
import { getStudentDashboardData, getSupervisorDashboardData, getCoordinatorDashboardData, getActivityLogs } from "../services/dashboard";

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

router.get("/dashboard/student", requireAuth, async (req, res): Promise<void> => {
  try {
    const data = await getStudentDashboardData(req.user!.id);
    res.json(data);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/dashboard/supervisor", requireAuth, async (req, res): Promise<void> => {
  try {
    const data = await getSupervisorDashboardData(req.user!.id);
    res.json(data);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/dashboard/coordinator", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  try {
    const data = await getCoordinatorDashboardData(req.user!.id);
    res.json(data);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/activity-logs", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  try {
    const logs = await getActivityLogs(req.user!.id);
    res.json(logs);
  } catch (error) {
    handleServiceError(res, error);
  }
});

export default router;

