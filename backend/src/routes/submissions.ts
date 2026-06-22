import { Router } from "express";
import type { IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  formatSubmissions,
  getStudentSubmissions,
  getSupervisorSubmissions,
  getAllSubmissions,
  validateStudentCanSubmit,
  uploadSubmission,
  createDirectSubmission,
  reviewSubmission,
} from "../services/submissions";

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


router.get("/submissions", requireAuth, async (req, res): Promise<void> => {
  try {
    const taskIdRaw = req.query.taskId ? parseInt(String(req.query.taskId), 10) : null;
    const taskIdParam = taskIdRaw != null && !Number.isNaN(taskIdRaw) ? taskIdRaw : null;

    let formatted;
    if (req.user!.role === "student") {
      formatted = await getStudentSubmissions(req.user!.id, taskIdParam ?? undefined);
    } else if (req.user!.role === "supervisor") {
      formatted = await getSupervisorSubmissions(req.user!.id, taskIdParam ?? undefined);
    } else {
      formatted = await getAllSubmissions(taskIdParam ?? undefined);
    }

    res.json(formatted);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/submissions/upload", requireAuth, async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(String(req.query.taskId || ""), 10);
    if (Number.isNaN(taskId) || taskId <= 0) {
      res.status(400).json({ error: "taskId is required" });
      return;
    }

    const notes = typeof req.query.notes === "string" ? req.query.notes : "";
    const originalName = typeof req.query.filename === "string" ? req.query.filename : "submission.pdf";
    const contentType = typeof req.query.contentType === "string" ? req.query.contentType : req.headers["content-type"];

    if (contentType && !String(contentType).includes("pdf")) {
      res.status(400).json({ error: "Only PDF files are supported" });
      return;
    }

    if (req.user!.role === "student") {
      const validation = await validateStudentCanSubmit(taskId, req.user!.id);
      if (!validation.valid) {
        res.status(403).json({ error: validation.error });
        return;
      }
    }

    const result = await uploadSubmission(taskId, req.user!.id, req, originalName, notes);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/submissions", requireAuth, async (req, res): Promise<void> => {
  try {
    const { taskId, fileUrl, notes } = req.body;
    if (!taskId) {
      res.status(400).json({ error: "taskId required" });
      return;
    }

    if (req.user!.role === "student") {
      const validation = await validateStudentCanSubmit(taskId, req.user!.id);
      if (!validation.valid) {
        res.status(403).json({ error: validation.error });
        return;
      }
    }

    const result = await createDirectSubmission(taskId, req.user!.id, fileUrl, notes || "");
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/submissions/:id/review", requireAuth, async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { status, feedback } = req.body;
    if (!status || !["approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "Valid status required" });
      return;
    }

    const result = await reviewSubmission(id, status, feedback || "", req.user!.id);
    res.json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});


export default router;

