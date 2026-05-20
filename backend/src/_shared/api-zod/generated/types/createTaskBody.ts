import type { CreateTaskBodyPhase } from "./createTaskBodyPhase";

export interface CreateTaskBody {
  teamId: number;
  title: string;
  description?: string | null;
  deadline?: Date | null;
  phase: CreateTaskBodyPhase;
}
