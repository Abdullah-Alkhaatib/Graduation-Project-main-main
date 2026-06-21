import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import {
  getGetCoordinatorDashboardQueryKey,
  getListUsersQueryKey,
  ListUsersRole,
  useGetCoordinatorDashboard,
  useListUsers,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Briefcase, Mail, UserCheck, Shield, ArrowRight, UserMinus } from "lucide-react";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function CoordinatorSupervisors() {
  const { user } = useAuth();

  const { data: dashboard, isLoading: dashboardLoading } = useGetCoordinatorDashboard({
    query: {
      queryKey: getGetCoordinatorDashboardQueryKey(),
      enabled: user?.role === "coordinator",
    },
  });

  const { data: supervisors, isLoading: supervisorsLoading } = useListUsers(
    { role: ListUsersRole.supervisor },
    {
      query: {
        queryKey: getListUsersQueryKey({ role: ListUsersRole.supervisor }),
        enabled: user?.role === "coordinator",
      },
    }
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deletingSupervisorId, setDeletingSupervisorId] = useState<number | null>(null);

  const supervisorsWithTeams = useMemo(() => {
    const supervisorsList = Array.isArray(supervisors) ? supervisors : [];
    const teamsList = dashboard?.allTeamsList ?? [];

    return supervisorsList.map((supervisor) => {
      const assignedTeams = teamsList.filter((team) => team.supervisor?.id === supervisor.id || team.supervisorId === supervisor.id);
      const workload = dashboard?.supervisorWorkload.find((item) => item.supervisor.id === supervisor.id);

      return {
        supervisor,
        assignedTeams,
        teamCount: workload?.teamCount ?? assignedTeams.length,
      };
    });
  }, [dashboard?.allTeamsList, dashboard?.supervisorWorkload, supervisors]);

  const handleDeleteSupervisor = async (supervisorId: number, supervisorName: string) => {
    if (!window.confirm(`Delete supervisor "${supervisorName}" from the system? This will also unassign them from any teams.`)) {
      return;
    }

    setDeletingSupervisorId(supervisorId);
    try {
      const response = await fetch(`/api/users/${supervisorId}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || "Failed to delete supervisor.");
      }

      await queryClient.invalidateQueries({ queryKey: getGetCoordinatorDashboardQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ role: ListUsersRole.supervisor }) });
      toast({ title: "Supervisor Deleted", description: "The supervisor was removed from the system." });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to delete supervisor.", variant: "destructive" });
    } finally {
      setDeletingSupervisorId(null);
    }
  };

  if (user?.role !== "coordinator") {
    return (
      <AppLayout title="Supervisor Management">
        <div className="flex flex-col items-center justify-center p-12 text-center bg-card rounded-lg border border-dashed mt-8">
          <h2 className="text-2xl font-bold tracking-tight">Access Denied</h2>
          <p className="text-muted-foreground max-w-md mt-2 mb-6">
            Only coordinators can access this page.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Supervisor Management">
      <div className="space-y-6">
        <div className="page-heading">
          <div className="space-y-2">
            <div className="section-label">Supervisors</div>
            <h2 className="text-3xl font-black tracking-tight">Supervisor Management</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">See each supervisor and the teams assigned to them in a cleaner layout.</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="gap-2 px-3 py-1.5">
              <Users className="h-3.5 w-3.5" />
              {dashboard?.totalSupervisors ?? 0} supervisors
            </Badge>
            <Badge variant="outline" className="gap-2 px-3 py-1.5">
              <Briefcase className="h-3.5 w-3.5" />
              {dashboard?.totalTeams ?? 0} teams
            </Badge>
          </div>
        </div>

        {dashboardLoading || supervisorsLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, index) => (
              <Card key={index} className="glass-card">
                <CardHeader>
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : supervisorsWithTeams.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center bg-card rounded-lg border border-dashed">
            <Shield className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No supervisors found</h3>
            <p className="text-muted-foreground max-w-sm mt-1">
              There are no supervisor accounts in the system yet.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {supervisorsWithTeams.map(({ supervisor, assignedTeams, teamCount }) => (
              <Card key={supervisor.id} className="glass-card flex flex-col">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {(supervisor.name?.charAt(0) || "S").toUpperCase()}
                      </div>
                      <div>
                        <CardTitle className="text-base">{supervisor.name}</CardTitle>
                        <CardDescription className="flex items-center gap-1 text-xs">
                          <Mail className="h-3 w-3" />
                          {supervisor.email}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge variant={teamCount > 0 ? "secondary" : "outline"} className="shrink-0">
                        {teamCount} teams
                      </Badge>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={deletingSupervisorId === supervisor.id}
                        onClick={() => handleDeleteSupervisor(supervisor.id, supervisor.name || "Supervisor")}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        {deletingSupervisorId === supervisor.id ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex-1 space-y-3">
                  <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Role</span>
                      <span className="font-medium capitalize">{supervisor.role}</span>
                    </div>
                    {/* <div className="mt-2 flex items-center justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
                        <UserCheck className="h-3.5 w-3.5" />
                        Active
                      </span>
                    </div> */}
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Managed Teams
                    </p>
                    {assignedTeams.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                        No teams assigned yet.
                      </div>
                    ) : (
                      <ScrollArea className="h-44 pr-3">
                        <div className="space-y-2">
                          {assignedTeams.map((team) => (
                            <div key={team.id} className="rounded-lg border p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium leading-tight">{team.name}</p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {team.projectTitle || "No project title"}
                                  </p>
                                </div>
                                <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                                  {team.currentPhase || team.status}
                                </Badge>
                              </div>
                              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                                <span>{team.memberCount} members</span>
                                <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                                  <Link href={`/teams/${team.id}`}>
                                    Open
                                    <ArrowRight className="h-3.5 w-3.5" />
                                  </Link>
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
