import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/layout/AppLayout";
import { 
  useGetStudentDashboard, 
  useGetSupervisorDashboard, 
  useGetCoordinatorDashboard 
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Users, CheckSquare, Bell, Clock, Calendar, CheckCircle2, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function Dashboard() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <AppLayout title="Dashboard">
      <div className="space-y-6">
        <div className="page-heading">
          <h2 className="text-2xl font-bold tracking-tight">Welcome back, {user.name}</h2>
          <p className="mt-1 text-muted-foreground">
            Here's what's happening with your graduation projects today.
          </p>
        </div>

        {user.role === "student" && <StudentDashboardView />}
        {user.role === "supervisor" && <SupervisorDashboardView />}
        {user.role === "coordinator" && <CoordinatorDashboardView />}
      </div>
    </AppLayout>
  );
}

function StudentDashboardView() {
  const { data, isLoading } = useGetStudentDashboard();

  if (isLoading) return <DashboardSkeleton />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          title="Team Status" 
          value={data.team ? "Active" : "No Team"} 
          description={data.team ? data.team.name : "Join or create a team"}
          icon={Users}
          primary
        />
        {/* <StatCard 
          title="Current Phase" 
          value={data.currentPhase ? data.currentPhase.charAt(0).toUpperCase() + data.currentPhase.slice(1) : "None"} 
          description="Project progression"
          icon={Activity}
        /> */}
        <StatCard 
          title="Pending Tasks" 
          value={data.pendingTasks.toString()} 
          description="Requires attention"
          icon={CheckSquare}
        />
        <StatCard 
          title="Unread Alerts" 
          value={data.unreadNotifications.toString()} 
          description="New notifications"
          icon={Bell}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="dashboard-panel col-span-4">
          <CardHeader>
            <CardTitle>My Recent Activity</CardTitle>
            <CardDescription>Latest updates related to your account</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityList activities={data.recentActivity} />
          </CardContent>
        </Card>
        
        <Card className="dashboard-panel col-span-3">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-4 rounded-md border border-primary/10 bg-white/70 p-3">
                <MailIcon className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">Invitations</p>
                  <p className="text-sm text-muted-foreground">{data.pendingInvitations} pending invitations</p>
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-md border border-primary/10 bg-white/70 p-3">
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">Submissions</p>
                  <p className="text-sm text-muted-foreground">{data.submittedTasks} tasks submitted</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SupervisorDashboardView() {
  const { data, isLoading } = useGetSupervisorDashboard();

  if (isLoading) return <DashboardSkeleton />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          title="Assigned Teams" 
          value={data.assignedTeams.toString()} 
          description="Teams under supervision"
          icon={Users}
          primary
        />
        <StatCard 
          title="Pending Requests" 
          value={data.pendingRequests.toString()} 
          description="Supervision requests"
          icon={AlertCircle}
        />
        <StatCard 
          title="Pending Reviews" 
          value={data.pendingReviews.toString()} 
          description="Submissions to review"
          icon={CheckSquare}
        />
        <StatCard 
          title="Pending Meetings" 
          value={data.pendingMeetings.toString()} 
          description="Meeting requests"
          icon={Calendar}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="dashboard-panel col-span-4">
          <CardHeader>
            <CardTitle>My Recent Activity</CardTitle>
            <CardDescription>Your latest actions and updates</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityList activities={data.recentActivity} />
          </CardContent>
        </Card>
        
        <Card className="dashboard-panel col-span-3">
          <CardHeader>
            <CardTitle>Your Teams</CardTitle>
            <CardDescription>Quick overview</CardDescription>
          </CardHeader>
          <CardContent>
            {data.teams.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No teams assigned yet.</p>
            ) : (
              <div className="space-y-4">
                {data.teams.map(team => (
                  <div key={team.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <div>
                      <p className="font-medium">{team.name}</p>
                      <p className="text-xs text-muted-foreground">{team.projectTitle || "No project title"}</p>
                    </div>
                    <div className="text-xs px-2 py-1 bg-muted rounded-md capitalize">
                      {team.currentPhase || team.status}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CoordinatorDashboardView() {
  const { data, isLoading } = useGetCoordinatorDashboard();

  if (isLoading) return <DashboardSkeleton />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          title="Total Teams" 
          value={data.totalTeams.toString()} 
          description="Active teams in system"
          icon={Users}
          primary
        />
        <StatCard 
          title="Unassigned Teams" 
          value={data.unassignedTeams.toString()} 
          description="Need supervisor"
          icon={AlertCircle}
        />
        <StatCard 
          title="Total Students" 
          value={data.totalStudents.toString()} 
          description="Registered students"
          icon={Users}
        />
        <StatCard
          title="Total Supervisors" 
          value={data.totalSupervisors.toString()} 
          description="Available faculty"
          icon={Users}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>System Activity</CardTitle>
            <CardDescription>Recent events across the platform</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityList activities={data.recentActivity} />
          </CardContent>
        </Card>
        
        <div className="col-span-3 space-y-4">
          {/* <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Projects by Phase</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Proposal</span>
                  <span className="font-medium">{data.teamsPerPhase.proposal}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Progress</span>
                  <span className="font-medium">{data.teamsPerPhase.progress}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Final</span>
                  <span className="font-medium">{data.teamsPerPhase.final}</span>
                </div>
              </div>
            </CardContent>
          </Card> */}
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Unassigned Teams</CardTitle>
            </CardHeader>
            <CardContent>
              {data.unassignedTeamsList.length === 0 ? (
                <p className="text-sm text-muted-foreground">All teams have a supervisor.</p>
              ) : (
                <div className="space-y-2">
                  {data.unassignedTeamsList.slice(0, 3).map(team => (
                    <div key={team.id} className="text-sm flex justify-between">
                      <span className="truncate max-w-44 font-medium">{team.name}</span>
                      <span className="text-muted-foreground">{team.memberCount} members</span>
                    </div>
                  ))}
                  {data.unassignedTeamsList.length > 3 && (
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      +{data.unassignedTeamsList.length - 3} more
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, description, icon: Icon, primary = false }: any) {
  return (
    <Card className={primary ? "dashboard-stat-card border-primary/50" : "dashboard-stat-card"}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          {title}
        </CardTitle>
        <Icon className={`h-4 w-4 ${primary ? "text-primary" : "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function ActivityList({ activities }: { activities: any[] }) {
  if (!activities || activities.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No recent activity.</p>;
  }

  return (
    <div className="space-y-4">
      {activities.map((activity) => (
        <div key={activity.id} className="flex items-start gap-4 border-b pb-4 last:border-0 last:pb-0">
          <div className="rounded-full bg-muted p-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium leading-none">{activity.description}</p>
            <p className="text-xs text-muted-foreground">
              {format(new Date(activity.createdAt), 'MMM d, yyyy • h:mm a')}
              {activity.user && ` • by ${activity.user.name}`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-3 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <Skeleton className="h-5 w-36 mb-2" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-[80%]" />
                  <Skeleton className="h-3 w-[40%]" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader>
            <Skeleton className="h-5 w-28" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-15 w-full" />
            <Skeleton className="h-15 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// simple mail icon component since it wasn't imported
function MailIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}