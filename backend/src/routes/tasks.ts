import { Router } from "express";
import type { IRouter } from "express";
import { requireAuth, requireRole } from "../lib/session";
import { getStudentTasks, getSupervisorTasks, getAllTasks, getTaskById, createTask, updateTask } from "../services/tasks";

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

router.get("/tasks", requireAuth, async (req, res): Promise<void> => {
  try {
    let tasks;

    if (req.user!.role === "student") {
      tasks = await getStudentTasks(req.user!.id);
    } else if (req.user!.role === "supervisor") {
      tasks = await getSupervisorTasks(req.user!.id);
    } else {
      tasks = await getAllTasks();
    }

    res.json(tasks);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/tasks", requireAuth, requireRole("supervisor", "coordinator"), async (req, res): Promise<void> => {
  try {
    const { teamId, title, description, deadline, phase } = req.body;
    const task = await createTask(req.user!.id, req.user!.role, {
      teamId,
      title,
      description,
      deadline,
      phase,
    });
    res.status(201).json(task);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const task = await getTaskById(id, req.user!.id, req.user!.role);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json(task);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.put("/tasks/:id", requireAuth, requireRole("supervisor", "coordinator"), async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { title, description, deadline, status } = req.body;
    const task = await updateTask(id, req.user!.id, req.user!.role, {
      title,
      description,
      deadline,
      status,
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json(task);
  } catch (error) {
    handleServiceError(res, error);
  }
});

export default router;

