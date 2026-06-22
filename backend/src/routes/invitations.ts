import { Router } from "express";
import type { IRouter } from "express";
import { requireAuth } from "../lib/session";
import {
  formatInvitation,
  getUserInvitations,
  inviteStudentToTeamByStudentId,
  acceptInvitationResponse,
  rejectInvitationResponse,
  ServiceError,
} from "../services/invitations";

const router: IRouter = Router();

function handleServiceError(res: any, error: unknown) {
  if (error instanceof ServiceError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Internal server error" });
}

router.get("/invitations", requireAuth, async (req, res): Promise<void> => {
  try {
    const invitations = await getUserInvitations(req.user!.id);
    const formatted = (await Promise.all(invitations.map(formatInvitation))).filter((inv): inv is NonNullable<typeof inv> => Boolean(inv));
    const visible = formatted.filter((inv) => {
      // Hide candidate-facing parent invitation when team approval voting is required.
      if (inv.requiresTeamApproval && !inv.approvalForInvitationId) {
        if (inv.team.leaderId === req.user!.id) return true;
        // show parent invitation to the invited user once the team has approved
        if (inv.teamApproved === true && inv.invitedUser?.id === req.user!.id) return true;
        return false;
      }
      return true;
    });
    res.json(visible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/invitations", requireAuth, async (req, res): Promise<void> => {
  const { teamId, studentId } = req.body;
  if (!teamId || !studentId) {
    res.status(400).json({ error: "teamId and studentId required" });
    return;
  }

  try {
    const inv = await inviteStudentToTeamByStudentId(teamId, studentId, req.user!.id);
    res.status(201).json(await formatInvitation(inv));
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/invitations/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const result = await acceptInvitationResponse(id, req.user!.id);
    res.json({ message: result.message });
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/invitations/:id/reject", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const result = await rejectInvitationResponse(id, req.user!.id);
    res.json({ message: result.message });
  } catch (error) {
    handleServiceError(res, error);
  }
});

export default router;

