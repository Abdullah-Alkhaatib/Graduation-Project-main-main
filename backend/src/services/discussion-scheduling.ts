import type { Team } from "@workspace/db";
import type { User } from "@workspace/db";

export type DiscussionSettingsInput = {
  startDate: string;
  endDate: string;
  workStartHour: string;
  workEndHour: string;
  discussionDuration: number;
  breakDuration: number;
  roomsCount: number;
  includedTeamIds?: number[];
};

export type DiscussionScheduleSlot = {
  date: string;
  room: string;
  startTime: string;
  endTime: string;
  dateIndex: number;
  roomIndex: number;
  timeIndex: number;
};

export type DiscussionScheduleDraft = {
  teamId: number;
  supervisorId: number;
  examiner1Id: number;
  examiner2Id: number;
  room: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "scheduled";
};

export type DiscussionScheduleOverview = {
  totalSessions: number;
  teamCount: number;
  roomCount: number;
  examinerCount: number;
  supervisorCount: number;
  dayCount: number;
  maxConcurrentSessions: number;
};

export type DiscussionScheduleResult = {
  schedules: DiscussionScheduleDraft[];
  warnings: string[];
  overview: DiscussionScheduleOverview;
};

function parseTimeToMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid time format: ${value}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time value: ${value}`);
  }
  return hours * 60 + minutes;
}

function formatMinutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function getDatesBetween(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid start or end date");
  }
  if (start > end) {
    throw new Error("Start date must be on or before end date");
  }
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function buildSlots(settings: DiscussionSettingsInput) {
  const { startDate, endDate, workStartHour, workEndHour, discussionDuration, breakDuration, roomsCount } = settings;
  const dates = getDatesBetween(startDate, endDate);
  const startMinutes = parseTimeToMinutes(workStartHour);
  const endMinutes = parseTimeToMinutes(workEndHour);

  if (startMinutes >= endMinutes) {
    throw new Error("Daily start time must be before daily end time");
  }

  const dailySlots: Array<{ startTime: string; endTime: string }> = [];
  let current = startMinutes;
  while (current + discussionDuration <= endMinutes) {
    dailySlots.push({
      startTime: formatMinutesToTime(current),
      endTime: formatMinutesToTime(current + discussionDuration),
    });
    current += discussionDuration + breakDuration;
  }

  if (dailySlots.length === 0) {
    throw new Error("No discussion time slots can be generated with the provided hours and duration");
  }

  const slots: DiscussionScheduleSlot[] = [];
  for (let timeIndex = 0; timeIndex < dailySlots.length; timeIndex += 1) {
    for (let roomIndex = 0; roomIndex < roomsCount; roomIndex += 1) {
      for (let dateIndex = 0; dateIndex < dates.length; dateIndex += 1) {
        slots.push({
          date: dates[dateIndex],
          room: `Room ${roomIndex + 1}`,
          startTime: dailySlots[timeIndex].startTime,
          endTime: dailySlots[timeIndex].endTime,
          dateIndex,
          roomIndex,
          timeIndex,
        });
      }
    }
  }

  return slots;
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

function buildPairKey(examiner1Id: number, examiner2Id: number) {
  return [examiner1Id, examiner2Id].sort((a, b) => a - b).join("_");
}

function getConsecutivePenalty(
  examinerId: number,
  currentSlot: DiscussionScheduleSlot,
  examinerHistory: Map<number, DiscussionScheduleSlot[]>,
) {
  const history = examinerHistory.get(examinerId) ?? [];
  return history.reduce((penalty, previous) => {
    if (previous.date === currentSlot.date) {
      if (Math.abs(previous.timeIndex - currentSlot.timeIndex) === 1) {
        return penalty + 10;
      }
    }
    return penalty;
  }, 0);
}

export async function buildDiscussionSchedule(
  teams: Array<Team & { supervisorId: number | null; supervisorName: string; supervisorEmail: string }> ,
  supervisors: Array<User>,
  settings: DiscussionSettingsInput,
): Promise<DiscussionScheduleResult> {
  if (settings.roomsCount < 1) {
    throw new Error("Rooms count must be at least 1");
  }

  const validTeams = teams.filter((team) => team.supervisorId !== null);
  if (validTeams.length === 0) {
    throw new Error("No teams with assigned supervisors are available for scheduling.");
  }

  const includedTeamIds = settings.includedTeamIds?.length ? new Set(settings.includedTeamIds) : null;
  const candidateTeams = includedTeamIds
    ? validTeams.filter((team) => includedTeamIds.has(team.id))
    : validTeams;

  if (candidateTeams.length === 0) {
    throw new Error("No included teams are eligible for scheduling.");
  }

  const slots = buildSlots(settings);
  if (candidateTeams.length > slots.length) {
    throw new Error("Not enough scheduling capacity. Increase working hours, add rooms, or shorten the discussion duration.");
  }

  const warnings: string[] = [];
  const maxConcurrentSessions = Math.floor(supervisors.length / 3);
  if (settings.roomsCount > maxConcurrentSessions) {
    warnings.push(
      `Selected ${settings.roomsCount} rooms, but only ${supervisors.length} instructor(s) are available. ` +
      `At most ${maxConcurrentSessions} session(s) can run in parallel with the current supervisor pool. ` +
      `The scheduler will therefore spread sessions across additional time slots.`,
    );
  }

  const instructorLookup = new Map<number, User>();
  supervisors.forEach((supervisor) => instructorLookup.set(supervisor.id, supervisor));

  const scheduleAssignments: DiscussionScheduleDraft[] = [];
  const busyBySlot = new Map<string, Set<number>>();
  const examinerLoads = new Map<number, number>();
  const examinerHistory = new Map<number, DiscussionScheduleSlot[]>();
  const pairCounts = new Map<string, number>();

  const availableExaminerIds = supervisors.map((supervisor) => supervisor.id);

  function isInstructorBusy(examinerId: number, slot: DiscussionScheduleSlot) {
    const busy = busyBySlot.get(`${slot.date}|${slot.startTime}`);
    return busy?.has(examinerId) ?? false;
  }

  function markBusy(examinerId: number, slot: DiscussionScheduleSlot) {
    const key = `${slot.date}|${slot.startTime}`;
    const busy = busyBySlot.get(key) ?? new Set<number>();
    busy.add(examinerId);
    busyBySlot.set(key, busy);
    examinerLoads.set(examinerId, (examinerLoads.get(examinerId) ?? 0) + 1);
    const history = examinerHistory.get(examinerId) ?? [];
    history.push(slot);
    examinerHistory.set(examinerId, history);
  }

  const teamList = [...candidateTeams].sort((a, b) => a.name.localeCompare(b.name));

  for (const team of teamList) {
    if (team.supervisorId === null) {
      throw new Error(`Team ${team.name} is missing a supervisor and can’t be scheduled.`);
    }

    const supervisorId = team.supervisorId;

    const slot = slots.find((slotEntry, index) => {
      const slotKey = `${slotEntry.date}|${slotEntry.startTime}`;
      const alreadyUsed = scheduleAssignments.some((assignment) => assignment.date === slotEntry.date && assignment.startTime === slotEntry.startTime && assignment.room === slotEntry.room);
      if (alreadyUsed) return false;
      if (isInstructorBusy(supervisorId, slotEntry)) return false;

      const candidateExaminerIds = availableExaminerIds.filter((examinerId) => examinerId !== supervisorId && !isInstructorBusy(examinerId, slotEntry));
      if (candidateExaminerIds.length < 2) return false;

      const pairOptions = [] as Array<{
        examiner1Id: number;
        examiner2Id: number;
        score: number;
      }>;

      for (let i = 0; i < candidateExaminerIds.length; i += 1) {
        for (let j = i + 1; j < candidateExaminerIds.length; j += 1) {
          const examiner1Id = candidateExaminerIds[i];
          const examiner2Id = candidateExaminerIds[j];
          if (examiner1Id === team.supervisorId || examiner2Id === team.supervisorId) continue;
          const pairKey = buildPairKey(examiner1Id, examiner2Id);
          const loadScore = (examinerLoads.get(examiner1Id) ?? 0) + (examinerLoads.get(examiner2Id) ?? 0);
          const pairPenalty = pairCounts.get(pairKey) ?? 0;
          const consecutivePenalty =
            getConsecutivePenalty(examiner1Id, slotEntry, examinerHistory) +
            getConsecutivePenalty(examiner2Id, slotEntry, examinerHistory);

          pairOptions.push({
            examiner1Id,
            examiner2Id,
            score: loadScore * 10 + pairPenalty * 100 + consecutivePenalty,
          });
        }
      }

      if (pairOptions.length === 0) {
        return false;
      }

      pairOptions.sort((a, b) => a.score - b.score);
      const best = pairOptions[0];
      scheduleAssignments.push({
        teamId: team.id,
        supervisorId,
        examiner1Id: best.examiner1Id,
        examiner2Id: best.examiner2Id,
        room: slotEntry.room,
        date: slotEntry.date,
        startTime: slotEntry.startTime,
        endTime: slotEntry.endTime,
        status: "scheduled",
      });

      markBusy(supervisorId, slotEntry);
      markBusy(best.examiner1Id, slotEntry);
      markBusy(best.examiner2Id, slotEntry);
      const pairKey = buildPairKey(best.examiner1Id, best.examiner2Id);
      pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
      return true;
    });

    if (!slot) {
      throw new Error(`Unable to place team ${team.name} without causing supervisor or examiner conflicts. Adjust schedule parameters or add more rooms/examiners.`);
    }
  }

  const uniqueExaminerIds = new Set<number>();
  scheduleAssignments.forEach((assignment) => {
    uniqueExaminerIds.add(assignment.examiner1Id);
    uniqueExaminerIds.add(assignment.examiner2Id);
  });

  const dayCount = new Set(scheduleAssignments.map((assignment) => assignment.date)).size;

  return {
    schedules: scheduleAssignments,
    warnings,
    overview: {
      totalSessions: scheduleAssignments.length,
      teamCount: candidateTeams.length,
      roomCount: settings.roomsCount,
      examinerCount: uniqueExaminerIds.size,
      supervisorCount: supervisors.length,
      dayCount,
      maxConcurrentSessions,
    },
  };
}
