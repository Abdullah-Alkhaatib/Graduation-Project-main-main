import { Router } from "express";
import type { IRouter } from "express";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middlewares/auth";
import { logActivity } from "../lib/notify";
import {
  buildDiscussionSchedule,
  type DiscussionSettingsInput,
  getAllDiscussionSchedules,
  getFilteredDiscussionSchedules,
  getLatestDiscussionSettings,
  saveDiscussionSchedule,
  checkScheduleConflicts,
  updateDiscussionSchedule,
  deleteDiscussionSchedule,
  getTeamsWithSupervisors,
  getSupervisorsForScheduling,
} from "../services/discussion-scheduling";

const router: IRouter = Router();

// ============ Validation Schemas ============

function handleServiceError(res: any, error: unknown) {
  if (error instanceof Error) {
    const message = error.message || "Internal server error";
    res.status(400).json({ error: message });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Internal server error" });
}

// ============ Validation Schemas ============

const generateRequestSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  workStartHour: z.string().regex(/^\d{1,2}:\d{2}$/),
  workEndHour: z.string().regex(/^\d{1,2}:\d{2}$/),
  discussionDuration: z.number().int().positive(),
  breakDuration: z.number().int().min(0),
  roomsCount: z.number().int().min(1),
  includedTeamIds: z.array(z.number()).optional(),
  includedSupervisorIds: z.array(z.number()).optional(),
});

const updateScheduleSchema = z.object({
  room: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  examiner1Id: z.number().int().optional(),
  examiner2Id: z.number().int().optional(),
  status: z.enum(["scheduled", "cancelled", "completed"]).optional(),
});

// ============ Routes ============

/**
 * GET /discussions
 * Get filtered discussion schedules based on user role
 */
router.get("/discussions", requireAuth, async (req, res): Promise<void> => {
  try {
    const filtered = await getFilteredDiscussionSchedules(req.user!.id, req.user!.role);
    const settings = await getLatestDiscussionSettings();

    res.json({ schedules: filtered, settings });
  } catch (error: any) {
    handleServiceError(res, error);
  }
});

/**
 * POST /discussions/generate
 * Generate a new discussion schedule based on settings and constraints
 */
router.post("/discussions/generate", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  try {
    const parsed = generateRequestSchema.parse(req.body);

    // Load teams and supervisors
    const teamsWithSupervisor = await getTeamsWithSupervisors(parsed.includedTeamIds);
    const supervisors = await getSupervisorsForScheduling(parsed.includedSupervisorIds);

    // Build the schedule
    const result = await buildDiscussionSchedule(teamsWithSupervisor, supervisors, parsed as DiscussionSettingsInput);

    // Save to database
    await saveDiscussionSchedule(result.schedules, parsed as DiscussionSettingsInput);

    // Fetch and return updated schedules
    const schedules = await getAllDiscussionSchedules();

    await logActivity("discussion_schedule_generated", "Generated a new discussion schedule.", req.user!.id);
    res.status(201).json({ schedules, warnings: result.warnings });
  } catch (error: any) {
    handleServiceError(res, error);
  }
});

/**
 * PUT /discussions/:id
 * Update a specific discussion schedule
 */
router.put("/discussions/:id", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = Number(raw);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid schedule ID" });
      return;
    }

    const validated = updateScheduleSchema.parse(req.body);

    // Get existing schedule
    const allSchedules = await getAllDiscussionSchedules();
    const existing = allSchedules.find((s) => s.id === id);
    if (!existing) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    // Validate examiners
    if (validated.examiner1Id && validated.examiner2Id && validated.examiner1Id === validated.examiner2Id) {
      res.status(400).json({ error: "Examiner 1 and Examiner 2 must be different people." });
      return;
    }

    const exam1 = validated.examiner1Id ?? existing.examiner1Id;
    const exam2 = validated.examiner2Id ?? existing.examiner2Id;
    if (exam1 === existing.supervisorId || exam2 === existing.supervisorId) {
      res.status(400).json({ error: "A supervisor cannot serve as an examiner for their own team." });
      return;
    }

    // Merge with existing data
    const merged = {
      date: validated.date ?? existing.date,
      startTime: validated.startTime ?? existing.startTime,
      endTime: validated.endTime ?? existing.endTime,
      room: validated.room ?? existing.room,
      supervisorId: existing.supervisorId,
      examiner1Id: exam1,
      examiner2Id: exam2,
    };

    // Check for conflicts
    if (checkScheduleConflicts(merged, allSchedules, id)) {
      res.status(400).json({ error: "The requested update causes an instructor or room conflict." });
      return;
    }

    // Update schedule
    const updated = await updateDiscussionSchedule(id, validated);
    const schedules = await getAllDiscussionSchedules();

    await logActivity("discussion_schedule_updated", "Updated a discussion session.", req.user!.id);
    res.json({ schedule: updated, schedules });
  } catch (error: any) {
    handleServiceError(res, error);
  }
});

/**
 * DELETE /discussions/:id
 * Delete a discussion schedule
 */
router.delete("/discussions/:id", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = Number(raw);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid schedule ID" });
      return;
    }

    await deleteDiscussionSchedule(id);
    await logActivity("discussion_schedule_deleted", "Deleted a discussion session.", req.user!.id);

    res.json({ message: "Schedule removed" });
  } catch (error: any) {
    handleServiceError(res, error);
  }
});

export default router;
