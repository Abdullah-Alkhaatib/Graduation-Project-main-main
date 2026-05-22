import { Router } from "express";
import type { IRouter } from "express";
import { z } from "zod/v4";
import { db, usersTable, teamsTable, teamMembersTable, discussionSchedulesTable, discussionSettingsTable } from "@workspace/db";
import { eq } from "@workspace/db";
import { requireAuth, requireRole } from "../lib/session";
import { logActivity } from "../lib/notify";
import { buildDiscussionSchedule, type DiscussionSettingsInput } from "../services/discussion-scheduling";

const router: IRouter = Router();

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

function parseTimeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function timeRangeOverlaps(
  dateA: string,
  startA: string,
  endA: string,
  dateB: string,
  startB: string,
  endB: string,
) {
  if (dateA !== dateB) return false;
  const aStart = parseTimeToMinutes(startA);
  const aEnd = parseTimeToMinutes(endA);
  const bStart = parseTimeToMinutes(startB);
  const bEnd = parseTimeToMinutes(endB);
  return aStart < bEnd && bStart < aEnd;
}

async function buildScheduleResponse() {
  const schedules = await db.select().from(discussionSchedulesTable);
  const teams = await db.select().from(teamsTable);
  const users = await db.select().from(usersTable);
  const settingsList = await db.select().from(discussionSettingsTable);
  const settings = settingsList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

  return schedules.map((schedule) => {
    const team = teams.find((teamItem) => teamItem.id === schedule.teamId);
    const supervisor = users.find((user) => user.id === schedule.supervisorId) ?? null;
    const examiner1 = users.find((user) => user.id === schedule.examiner1Id) ?? null;
    const examiner2 = users.find((user) => user.id === schedule.examiner2Id) ?? null;
    return {
      ...schedule,
      team,
      supervisor,
      examiner1,
      examiner2,
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.room.localeCompare(b.room));
}

router.get("/discussions", requireAuth, async (req, res): Promise<void> => {
  try {
    const allSchedules = await buildScheduleResponse();
    const userId = req.user!.id;
    let filtered = allSchedules;

    if (req.user!.role === "supervisor") {
      filtered = allSchedules.filter((schedule) =>
        schedule.supervisorId === userId || schedule.examiner1Id === userId || schedule.examiner2Id === userId,
      );
    }

    if (req.user!.role === "student") {
      const teamMemberships = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
      const teamIds = new Set(teamMemberships.map((membership) => membership.teamId));
      filtered = allSchedules.filter((schedule) => schedule.team && teamIds.has(schedule.team.id));
    }

    const settingsList = await db.select().from(discussionSettingsTable);
    const settings = settingsList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

    res.json({ schedules: filtered, settings });
  } catch (error) {
    res.status(500).json({ error: "Failed to load discussion schedules" });
  }
});

router.post("/discussions/generate", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  try {
    const parsed = generateRequestSchema.parse(req.body);
    const allTeams = await db.select().from(teamsTable);
    const teamsWithSupervisor = await Promise.all(allTeams.map(async (team) => {
      const supervisorId = team.supervisorId;
      const supervisorName = supervisorId ? (await db.select().from(usersTable).where(eq(usersTable.id, supervisorId))).at(0)?.name ?? "" : "";
      const supervisorEmail = supervisorId ? (await db.select().from(usersTable).where(eq(usersTable.id, supervisorId))).at(0)?.email ?? "" : "";
      return { ...team, supervisorId, supervisorName, supervisorEmail };
    }));

    const allSupervisors = await db.select().from(usersTable).then((users) => users.filter((user) => user.role === "supervisor"));
    const supervisors = parsed.includedSupervisorIds?.length
      ? allSupervisors.filter((sup) => parsed.includedSupervisorIds!.includes(sup.id))
      : allSupervisors;

    const { schedules, warnings } = await buildDiscussionSchedule(teamsWithSupervisor, supervisors, parsed as DiscussionSettingsInput);

    const existingSchedules = await db.select().from(discussionSchedulesTable);
    await Promise.all(existingSchedules.map((schedule) => db.delete(discussionSchedulesTable).where(eq(discussionSchedulesTable.id, schedule.id))));

    const existingSettings = await db.select().from(discussionSettingsTable);
    await Promise.all(existingSettings.map((setting) => db.delete(discussionSettingsTable).where(eq(discussionSettingsTable.id, setting.id))));

    const insertedSchedules = await db.insert(discussionSchedulesTable).values(schedules).returning();
    await db.insert(discussionSettingsTable).values({
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      workStartHour: parsed.workStartHour,
      workEndHour: parsed.workEndHour,
      discussionDuration: parsed.discussionDuration,
      breakDuration: parsed.breakDuration,
      roomsCount: parsed.roomsCount,
      includedTeamIds: parsed.includedTeamIds ?? null,
    });

    const response = await buildScheduleResponse();

    await logActivity("discussion_schedule_generated", "Generated a new discussion schedule.", req.user!.id);
    res.status(201).json({ schedules: response, warnings });
  } catch (error: any) {
    const message = error?.message || "Unable to generate schedule.";
    res.status(400).json({ error: message });
  }
});

router.put("/discussions/:id", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  try {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = Number(raw);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid schedule ID" });
      return;
    }

    const validated = updateScheduleSchema.parse(req.body);
    const [existing] = await db.select().from(discussionSchedulesTable).where(eq(discussionSchedulesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    const updatedValues: any = { ...validated };
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

    const merged = { ...existing, ...validated };
    const allSchedules = await db.select().from(discussionSchedulesTable);
    const conflicts = allSchedules.filter((schedule) => schedule.id !== id).some((schedule) => {
      const date = merged.date ?? existing.date;
      const startTime = merged.startTime ?? existing.startTime;
      const endTime = merged.endTime ?? existing.endTime;
      const room = merged.room ?? existing.room;
      const supervisorId = merged.supervisorId ?? existing.supervisorId;
      const examiner1Id = merged.examiner1Id ?? existing.examiner1Id;
      const examiner2Id = merged.examiner2Id ?? existing.examiner2Id;

      if (schedule.room === room && timeRangeOverlaps(date, startTime, endTime, schedule.date, schedule.startTime, schedule.endTime)) {
        return true;
      }

      const people = [supervisorId, examiner1Id, examiner2Id];
      const otherPeople = [schedule.supervisorId, schedule.examiner1Id, schedule.examiner2Id];
      if (timeRangeOverlaps(date, startTime, endTime, schedule.date, schedule.startTime, schedule.endTime)) {
        return people.some((person) => otherPeople.includes(person));
      }

      return false;
    });

    if (conflicts) {
      res.status(400).json({ error: "The requested update causes an instructor or room conflict." });
      return;
    }

    const [updated] = await db.update(discussionSchedulesTable).set(updatedValues).where(eq(discussionSchedulesTable.id, id)).returning();
    const response = await buildScheduleResponse();
    await logActivity("discussion_schedule_updated", "Updated a discussion session.", req.user!.id);
    res.json({ schedule: updated, schedules: response });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Failed to update schedule." });
  }
});

router.delete("/discussions/:id", requireAuth, requireRole("coordinator"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number(raw);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid schedule ID" });
    return;
  }

  await db.delete(discussionSchedulesTable).where(eq(discussionSchedulesTable.id, id));
  await logActivity("discussion_schedule_deleted", "Deleted a discussion session.", req.user!.id);
  res.json({ message: "Schedule removed" });
});

export default router;
