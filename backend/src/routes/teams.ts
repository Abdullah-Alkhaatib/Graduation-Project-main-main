import { Router } from "express";
import type { IRouter } from "express";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  addStudentToTeam,
  addUserByGenderToAutoTeam,
  createAnnouncement,
  createTeam,
  createTeamsByGender,
  deleteAnnouncementById,
  getAllAnnouncements,
  getTeamById,
  getTeamLeaveRequests,
  getTeamMembers,
  getTeamsWithFilters,
  getUserTeam,
  requestJoinTeam,
  requestLeaveTeam,
  removeTeamMemberFromTeam,
  transferTeamLeader,
  updateAnnouncementById,
  updateTeamForUser,
} from "../services/teams";

const router: IRouter = Router();

function parseId(rawValue: string | string[] | undefined): number | null {
  const raw = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (!raw) return null;
  const id = parseInt(raw, 10);
  return Number.isNaN(id) ? null : id;
}

function handleServiceError(res: any, error: unknown) {
  if (error instanceof Error) {
    const message = error.message || "Internal server error";
    res.status(400).json({ error: message });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Internal server error" });
}

router.get("/teams", requireAuth, async (req, res): Promise<void> => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const supervisorId = req.user!.role === "supervisor" ? req.user!.id : undefined;
    const teams = await getTeamsWithFilters({ status, search, supervisorId });
    res.json(teams);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/teams", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "student") {
    res.status(403).json({ error: "Only students can create teams" });
    return;
  }

  const { name, projectTitle, description, status } = req.body as {
    name?: string;
    projectTitle?: string | null;
    description?: string | null;
    status?: string;
  };

  if (!name) {
    res.status(400).json({ error: "Team name is required" });
    return;
  }

  try {
    const team = await createTeam(req.user!.id, {
      name,
      projectTitle: projectTitle ?? undefined,
      description: description ?? undefined,
      status,
    });
    res.status(201).json(team);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/teams/bulk-create-by-gender", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  try {
    const created = await createTeamsByGender(req.user!.id);
    res.status(201).json({ createdCount: created.length, created });
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/teams/my", requireAuth, async (req, res): Promise<void> => {
  try {
    const team = await getUserTeam(req.user!.id);
    if (!team) {
      res.status(404).json({ error: "Not in a team" });
      return;
    }
    res.json(team);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const teamId = parseId(req.params.id);
  if (teamId === null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const team = await getTeamById(teamId);
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    res.json(team);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.put("/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const teamId = parseId(req.params.id);
  if (teamId === null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { name, projectTitle, description, status } = req.body as {
    name?: string;
    projectTitle?: string | null;
    description?: string | null;
    status?: string;
  };

  try {
    const team = await updateTeamForUser(teamId, { name, projectTitle, description, status }, req.user!.id, req.user!.role);
    res.json(team);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/teams/:id/members", requireAuth, async (req, res): Promise<void> => {
  const teamId = parseId(req.params.id);
  if (teamId === null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const members = await getTeamMembers(teamId);
    res.json(members);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/team-announcements", requireAuth, async (req, res): Promise<void> => {
  try {
    const announcements = await getAllAnnouncements();
    res.json(announcements);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/team-announcements", requireAuth, async (req, res): Promise<void> => {
  const { title, description, teamId } = req.body as { title?: string; description?: string | null; teamId?: number | null };
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }

  try {
    const announcement = await createAnnouncement(req.user!.id, req.user!.name || "Leader", { title, description, teamId });
    res.status(201).json(announcement);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.put("/team-announcements/:id", requireAuth, async (req, res): Promise<void> => {
  const announcementId = parseId(req.params.id);
  if (announcementId === null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { title, description } = req.body as { title?: string; description?: string | null };

  try {
    const announcement = await updateAnnouncementById(announcementId, { title, description }, req.user!.id);
    res.json(announcement);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.delete("/team-announcements/:id", requireAuth, async (req, res): Promise<void> => {
  const announcementId = parseId(req.params.id);
  if (announcementId === null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    await deleteAnnouncementById(announcementId, req.user!.id);
    res.json({ message: "Announcement deleted" });
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/teams/:id/join-request", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "student") {
    res.status(403).json({ error: "Only students can request to join a team" });
    return;
  }

  const teamId = parseId(req.params.id);
  if (teamId === null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const result = await requestJoinTeam(teamId, req.user!.id, req.user!.name || "Student");
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/teams/:id/leave", requireAuth, async (req, res): Promise<void> => {
  const teamId = parseId(req.params.id);
  if (teamId === null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const result = await requestLeaveTeam(teamId, req.user!.id, req.user!.name || "Student");
    res.status(result.isPending ? 202 : 200).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/teams/:id/members/:memberId/remove", requireAuth, async (req, res): Promise<void> => {
  const teamId = parseId(req.params.id);
  const memberId = parseId(req.params.memberId);
  if (teamId === null || memberId === null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const result = await removeTeamMemberFromTeam(teamId, memberId, req.user!.id, req.user!.name || "Leader", req.user!.role);
    res.json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/teams/:id/transfer-leader", requireAuth, async (req, res): Promise<void> => {
  const teamId = parseId(req.params.id);
  const newLeaderId = typeof req.body.memberId === "number" ? req.body.memberId : parseInt(String(req.body.memberId || ""), 10);
  if (teamId === null || Number.isNaN(newLeaderId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const result = await transferTeamLeader(teamId, req.user!.id, newLeaderId);
    res.json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/teams/:id/add-member", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  const teamId = parseId(req.params.id);
  const targetUserId = typeof req.body.userId === "number" ? req.body.userId : parseInt(String(req.body.userId || ""), 10);
  if (teamId === null || Number.isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const result = await addStudentToTeam(teamId, targetUserId, req.user!.id);
    res.json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/teams/add-user-by-gender", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  const targetUserId = typeof req.body.userId === "number" ? req.body.userId : parseInt(String(req.body.userId || ""), 10);
  if (Number.isNaN(targetUserId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    const result = await addUserByGenderToAutoTeam(targetUserId, req.user!.id);
    res.status(result.createdNewTeam ? 201 : 200).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/teams/:id/leave-requests", requireAuth, async (req, res): Promise<void> => {
  const teamId = parseId(req.params.id);
  if (teamId === null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const leaveRequests = await getTeamLeaveRequests(teamId, req.user!.id);
    res.json(leaveRequests);
  } catch (error) {
    handleServiceError(res, error);
  }
});

export default router;
