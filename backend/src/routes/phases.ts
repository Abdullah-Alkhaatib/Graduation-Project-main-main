import { Router } from "express";
import type { IRouter } from "express";
import { requireAuth } from "../lib/session";
import { getAllPhases, getActivePhaseForTeam, advanceTeamPhase } from "../services/phases";

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

router.get("/phases", requireAuth, async (req, res): Promise<void> => {
  try {
    const phases = await getAllPhases();
    res.json(phases);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/phases/:teamId", requireAuth, async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.teamId) ? req.params.teamId[0] : req.params.teamId;
    const teamId = parseInt(raw, 10);
    if (isNaN(teamId)) {
      res.status(400).json({ error: "Invalid teamId" });
      return;
    }

    const phase = await getActivePhaseForTeam(teamId);
    res.json(phase);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/phases/:teamId/advance", requireAuth, async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.teamId) ? req.params.teamId[0] : req.params.teamId;
    const teamId = parseInt(raw, 10);
    if (isNaN(teamId)) {
      res.status(400).json({ error: "Invalid teamId" });
      return;
    }

    const phase = await advanceTeamPhase(teamId, req.user!.id, req.user!.role);
    res.json(phase);
  } catch (error) {
    handleServiceError(res, error);
  }
});

export default router;

