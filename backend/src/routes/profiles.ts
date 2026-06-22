import { Router } from "express";
import type { IRouter } from "express";
import { requireAuth } from "../lib/session";
import { getMyProfile, updateMyProfile, getProfileByUserId, getStudentTeam, getCoordinatorStudentProfiles, getAllStudentProfiles } from "../services/profiles";

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

router.get("/profiles/me", requireAuth, async (req, res): Promise<void> => {
  try {
    const profile = await getMyProfile(req.user!.id);
    res.json(profile);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.put("/profiles/me", requireAuth, async (req, res): Promise<void> => {
  try {
    const { gpa, skills, interests, description } = req.body;
    const profile = await updateMyProfile(req.user!.id, { gpa, skills, interests, description });
    res.json(profile);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/profiles/:userId", requireAuth, async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const userId = parseInt(raw, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const profile = await getProfileByUserId(userId);
    res.json(profile);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/profiles/:userId/team", requireAuth, async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const userId = parseInt(raw, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const team = await getStudentTeam(userId);
    res.json(team);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/coordinator/student-profiles", requireAuth, async (req, res): Promise<void> => {
  try {
    if (req.user!.role !== "coordinator") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { supervisorId } = req.query as { supervisorId?: string };
    const supervisorFilter = supervisorId ? parseInt(supervisorId, 10) : undefined;

    const profiles = await getCoordinatorStudentProfiles(supervisorFilter);
    res.json(profiles);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/profiles", requireAuth, async (req, res): Promise<void> => {
  try {
    const { skills, minGpa, search } = req.query as { skills?: string; minGpa?: string; search?: string };
    const minGpaNum = minGpa ? parseFloat(minGpa) : undefined;

    const profiles = await getAllStudentProfiles({ skills, minGpa: minGpaNum, search });
    res.json(profiles);
  } catch (error) {
    handleServiceError(res, error);
  }
});

export default router;

