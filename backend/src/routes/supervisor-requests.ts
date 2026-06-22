import { Router } from "express";
import type { IRouter } from "express";
import { requireAuth, requireRole } from "../lib/session";
import {
  formatRequest,
  getSupervisorRequests,
  validateCanSendRequest,
  createSupervisorRequest,
  validateRequestExists,
  acceptSupervisorRequestImpl,
  rejectSupervisorRequestImpl,
  clearTeamSupervisor,
  coordinatorAssignSupervisor,
  validateSupervisorCanUnassign,
  getUserTeamLeadershipOrNull,
} from "../services/supervisor-requests";

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

router.get("/supervisor-requests", requireAuth, async (req, res): Promise<void> => {
  try {
    const formatted = await getSupervisorRequests(req.user!.id, req.user!.role);
    res.json(formatted);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/supervisor-requests", requireAuth, requireRole("student"), async (req, res): Promise<void> => {
  try {
    const { supervisorId, message } = req.body;
    if (!supervisorId) {
      res.status(400).json({ error: "supervisorId required" });
      return;
    }

    const teamId = await getUserTeamLeadershipOrNull(req.user!.id);
    if (!teamId) {
      res.status(400).json({ error: "Only team leaders can send supervision requests" });
      return;
    }

    const validation = await validateCanSendRequest(req.user!.id, teamId, supervisorId);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const result = await createSupervisorRequest(teamId, supervisorId, req.user!.id, message || "");
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});


router.post("/supervisor-requests/:id/accept", requireAuth, requireRole("supervisor"), async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const validation = await validateRequestExists(id, req.user!.id);
    if (!validation.valid) {
      res.status(validation.error === "Request not found" ? 404 : 400).json({ error: validation.error });
      return;
    }

    const result = await acceptSupervisorRequestImpl(id, req.user!.id);
    res.json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/supervisor-requests/:id/reject", requireAuth, requireRole("supervisor"), async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const validation = await validateRequestExists(id, req.user!.id);
    if (!validation.valid) {
      res.status(validation.error === "Request not found" ? 404 : 400).json({ error: validation.error });
      return;
    }

    const result = await rejectSupervisorRequestImpl(id, req.user!.id);
    res.json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/coordinator/assign-supervisor", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  try {
    const { teamId, supervisorId } = req.body;
    if (!teamId || !supervisorId) {
      res.status(400).json({ error: "teamId and supervisorId required" });
      return;
    }

    const result = await coordinatorAssignSupervisor(teamId, supervisorId, req.user!.id);
    res.json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/coordinator/unassign-supervisor", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  try {
    const { teamId } = req.body;
    if (!teamId) {
      res.status(400).json({ error: "teamId required" });
      return;
    }

    const result = await clearTeamSupervisor(teamId);
    if ("error" in result) {
      res.status(result.error === "Team not found" ? 404 : 400).json({ error: result.error });
      return;
    }

    res.json({ message: "Supervisor removed successfully" });
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/supervisor/unassign-supervisor", requireAuth, requireRole("supervisor"), async (req, res): Promise<void> => {
  try {
    const { teamId } = req.body;
    if (!teamId) {
      res.status(400).json({ error: "teamId required" });
      return;
    }

    const validation = await validateSupervisorCanUnassign(teamId, req.user!.id);
    if (!validation.valid) {
      res.status(validation.error === "Team not found" ? 404 : 403).json({ error: validation.error });
      return;
    }

    const result = await clearTeamSupervisor(teamId);
    if ("error" in result) {
      res.status(result.error === "Team not found" ? 404 : 400).json({ error: result.error });
      return;
    }

    res.json({ message: "You stopped supervising this team" });
  } catch (error) {
    handleServiceError(res, error);
  }
});


export default router;

