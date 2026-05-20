import type { ActivityLog } from "./activityLog";
import type { CoordinatorDashboardSupervisorWorkloadItem } from "./coordinatorDashboardSupervisorWorkloadItem";
import type { CoordinatorDashboardTeamsPerPhase } from "./coordinatorDashboardTeamsPerPhase";
import type { Team } from "./team";

export interface CoordinatorDashboard {
  totalTeams: number;
  unassignedTeams: number;
  totalStudents: number;
  totalSupervisors: number;
  teamsPerPhase: CoordinatorDashboardTeamsPerPhase;
  supervisorWorkload: CoordinatorDashboardSupervisorWorkloadItem[];
  unassignedTeamsList: Team[];
  recentActivity: ActivityLog[];
}
