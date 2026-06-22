import { Router } from "express";
import type { IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { getSupervisorMeetings, getStudentMeetings, getAllMeetings, createMeetingRequest, approveMeeting, rejectMeeting } from "../services/meetings";

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

router.get("/meetings", requireAuth, async (req, res): Promise<void> => {
  try {
    let meetings;

    if (req.user!.role === "supervisor") {
      meetings = await getSupervisorMeetings(req.user!.id);
    } else if (req.user!.role === "student") {
      meetings = await getStudentMeetings(req.user!.id);
    } else {
      meetings = await getAllMeetings();
    }

    res.json(meetings);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/meetings", requireAuth, async (req, res): Promise<void> => {
  try {
    const { supervisorId, proposedDate, notes } = req.body;
    const meeting = await createMeetingRequest(req.user!.id, {
      supervisorId,
      proposedDate,
      notes,
    });
    res.status(201).json(meeting);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/meetings/:id/approve", requireAuth, async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const meeting = await approveMeeting(id, req.user!.id, req.user!.role);
    res.json(meeting);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/meetings/:id/reject", requireAuth, async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const meeting = await rejectMeeting(id, req.user!.id, req.user!.role);
    res.json(meeting);
  } catch (error) {
    handleServiceError(res, error);
  }
});

export default router;

