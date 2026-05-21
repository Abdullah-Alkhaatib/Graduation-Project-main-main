export type DiscussionScheduleSettings = {
  startDate: string;
  endDate: string;
  workStartHour: string;
  workEndHour: string;
  discussionDuration: number;
  breakDuration: number;
  roomsCount: number;
  includedTeamIds?: number[] | null;
};

export type DiscussionScheduleSession = {
  id: number;
  teamId: number;
  supervisorId: number;
  examiner1Id: number;
  examiner2Id: number;
  room: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  team?: {
    id: number;
    name: string;
    projectTitle?: string | null;
    supervisorId?: number | null;
  } | null;
  supervisor?: { id: number; name: string; email: string } | null;
  examiner1?: { id: number; name: string; email: string } | null;
  examiner2?: { id: number; name: string; email: string } | null;
};

export type DiscussionScheduleResponse = {
  schedules: DiscussionScheduleSession[];
  settings: DiscussionScheduleSettings | null;
};

async function apiFetch<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error || response.statusText || "API request failed");
  }
  return data as T;
}

export function fetchDiscussionSchedules() {
  return apiFetch<DiscussionScheduleResponse>("/api/discussions");
}

export function generateDiscussionSchedules(body: DiscussionScheduleSettings) {
  return apiFetch<DiscussionScheduleResponse>("/api/discussions/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateDiscussionSchedule(id: number, body: Partial<Omit<DiscussionScheduleSession, "id" | "team" | "supervisor" | "examiner1" | "examiner2">>) {
  return apiFetch<{ schedule: DiscussionScheduleSession; schedules: DiscussionScheduleSession[] }>(`/api/discussions/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteDiscussionSchedule(id: number) {
  return apiFetch<{ message: string }>(`/api/discussions/${id}`, { method: "DELETE" });
}

// Hooks are intentionally left out because the frontend uses React Query directly for scheduling operations.
