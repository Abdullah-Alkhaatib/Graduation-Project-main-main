import type { User } from "./user";

export interface ActivityLog {
  id: number;
  userId?: number | null;
  teamId?: number | null;
  action: string;
  description: string;
  createdAt: Date;
  user?: User | null;
}
