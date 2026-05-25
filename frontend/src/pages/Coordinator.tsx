import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { 
  useGetCoordinatorDashboard, 
  getGetCoordinatorDashboardQueryKey,
  useCoordinatorAssignSupervisor,
  useListSupervisorRequests,
  getListSupervisorRequestsQueryKey,
  useListUsers,
  getListUsersQueryKey,
  ListUsersRole,
  useListActivityLogs,
  getListActivityLogsQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import StudentIdBadge from "@/components/StudentIdBadge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { Users, Briefcase, Activity, UserPlus, Clock, UserMinus, UserX } from "lucide-react";
import { format } from "date-fns";

const assignSchema = z.object({
  supervisorId: z.string().min(1, "Please select a supervisor"),
});

export default function Coordinator() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [assigningTeamId, setAssigningTeamId] = useState<number | null>(null);
  const [removingTeamId, setRemovingTeamId] = useState<number | null>(null);
  const [creatingGenderTeams, setCreatingGenderTeams] = useState(false);
  const [assignStudentDialogOpen, setAssignStudentDialogOpen] = useState(false);
  const [assignTargetStudentId, setAssignTargetStudentId] = useState<number | null>(null);
  const [assignSelectedTeamId, setAssignSelectedTeamId] = useState<string>("");

  const { data: dashboard, isLoading: dashboardLoading } = useGetCoordinatorDashboard({
    query: {
      queryKey: getGetCoordinatorDashboardQueryKey(),
      enabled: user?.role === 'coordinator'
    }
  });

  const { data: supervisors } = useListUsers(
    { role: ListUsersRole.supervisor },
    {
      query: {
        queryKey: getListUsersQueryKey({ role: ListUsersRole.supervisor }),
        enabled: user?.role === 'coordinator'
      }
    }
  );

  const { data: logs, isLoading: logsLoading } = useListActivityLogs({
    query: {
      queryKey: getListActivityLogsQueryKey(),
      enabled: user?.role === 'coordinator'
    }
  });

  const { data: supervisorRequests } = useListSupervisorRequests({
    query: {
      queryKey: getListSupervisorRequestsQueryKey(),
      enabled: user?.role === 'coordinator'
    }
  });

  const pendingRequestByTeam = useMemo(() => {
    const map = new Map<number, { supervisorName: string; createdAt: Date | string }>();
    if (!supervisorRequests) return map;

    for (const request of supervisorRequests) {
      if (request.status !== 'pending') continue;
      const current = map.get(request.teamId);
      if (!current || new Date(request.createdAt).getTime() > new Date(current.createdAt).getTime()) {
        map.set(request.teamId, {
          supervisorName: request.supervisor?.name || 'Supervisor',
          createdAt: request.createdAt,
        });
      }
    }

    return map;
  }, [supervisorRequests]);

  const studentsGrouped = useMemo(() => {
    const list = dashboard?.studentsWithoutTeamsList ?? [];
    const male = list.filter((s: any) => s.gender === "Male");
    const female = list.filter((s: any) => s.gender === "Female");
    const unknown = list.filter((s: any) => !s.gender);
    return { male, female, unknown };
  }, [dashboard?.studentsWithoutTeamsList]);

  const assignSupervisor = useCoordinatorAssignSupervisor();

  const handleCreateGenderTeams = async () => {
    setCreatingGenderTeams(true);
    try {
      const response = await fetch("/api/teams/bulk-create-by-gender", { method: "POST", credentials: "include" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Failed to create teams");
      toast({ title: "Teams Created", description: `${result.createdCount} teams created` });
      await queryClient.invalidateQueries({ queryKey: getGetCoordinatorDashboardQueryKey() });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to create teams", variant: "destructive" });
    } finally {
      setCreatingGenderTeams(false);
    }
  };

  const openAssignStudentDialog = (studentId: number) => {
    setAssignTargetStudentId(studentId);
    setAssignSelectedTeamId("");
    setAssignStudentDialogOpen(true);
  };

  const handleAssignStudentToTeam = async (teamId: number) => {
    if (!assignTargetStudentId) return;
    try {
      const response = await fetch(`/api/teams/${teamId}/add-member`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: assignTargetStudentId }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Failed to add student to team");
      toast({ title: "Student Assigned", description: "Student added to the selected team." });
      setAssignStudentDialogOpen(false);
      setAssignTargetStudentId(null);
      await queryClient.invalidateQueries({ queryKey: getGetCoordinatorDashboardQueryKey() });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to assign student.", variant: "destructive" });
    }
  };

  const handleAddUserByGender = async (userId: number) => {
    try {
      const response = await fetch(`/api/teams/add-user-by-gender`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Failed to add user by gender");
      toast({ title: "Assigned", description: result.message || "User assigned to gender team." });
      await queryClient.invalidateQueries({ queryKey: getGetCoordinatorDashboardQueryKey() });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to assign user.", variant: "destructive" });
    }
  };

  const handleRemoveSupervisor = async (teamId: number) => {
    setRemovingTeamId(teamId);
    try {
      const response = await fetch("/api/coordinator/unassign-supervisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ teamId }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || "Failed to remove supervisor.");
      }

      await queryClient.invalidateQueries({ queryKey: getGetCoordinatorDashboardQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListActivityLogsQueryKey() });
      toast({ title: "Supervisor Removed", description: "The team no longer has a supervisor assigned." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to remove supervisor.", variant: "destructive" });
    } finally {
      setRemovingTeamId(null);
    }
  };

  const form = useForm<z.infer<typeof assignSchema>>({
    resolver: zodResolver(assignSchema),
    defaultValues: {
      supervisorId: "",
    },
  });

  const onAssign = async (data: z.infer<typeof assignSchema>) => {
    if (!assigningTeamId) return;
    try {
      await assignSupervisor.mutateAsync({
        data: {
          teamId: assigningTeamId,
          supervisorId: parseInt(data.supervisorId, 10)
        }
      });
      queryClient.invalidateQueries({ queryKey: getGetCoordinatorDashboardQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSupervisorRequestsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListActivityLogsQueryKey() });
      setAssigningTeamId(null);
      form.reset();
      toast({ title: "Request Sent", description: "The supervisor received a request and must accept it first." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to assign supervisor.", variant: "destructive" });
    }
  };

  if (user?.role !== 'coordinator') {
    return (
      <AppLayout title="Coordinator Panel">
        <div className="flex flex-col items-center justify-center p-12 text-center bg-card rounded-lg border border-dashed mt-8">
          <h2 className="text-2xl font-bold tracking-tight">Access Denied</h2>
          <p className="text-muted-foreground max-w-md mt-2 mb-6">
            Only coordinators can access this panel.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Coordinator Panel">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">System Administration</h2>
          <p className="text-muted-foreground">Manage teams, supervisors, and monitor system activity.</p>
        </div>

        <Tabs defaultValue="unassigned" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="unassigned" className="gap-2">
              <Briefcase className="h-4 w-4" />
              <span className="hidden sm:inline">Unassigned Teams</span>
              <span className="sm:hidden">Unassigned</span>
            </TabsTrigger>
            <TabsTrigger value="assigned" className="gap-2">
              <UserMinus className="h-4 w-4" />
              <span className="hidden sm:inline">Assigned Teams</span>
              <span className="sm:hidden">Assigned</span>
            </TabsTrigger>
            <TabsTrigger value="students" className="gap-2">
              <UserX className="h-4 w-4" />
              <span className="hidden sm:inline">Without Team</span>
              <span className="sm:hidden">Without Team</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="unassigned" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-primary" /> Unassigned Teams
                </CardTitle>
                <CardDescription>Teams waiting for a supervisor assignment.</CardDescription>
              </CardHeader>
              <CardContent>
                {dashboardLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : !dashboard?.unassignedTeamsList || dashboard.unassignedTeamsList.length === 0 ? (
                  <div className="text-center p-6 border rounded-lg border-dashed">
                    <p className="text-muted-foreground">All active teams have supervisors assigned.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {dashboard.unassignedTeamsList.map(team => (
                      <div key={team.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between border rounded-lg p-4 gap-4">
                        <div>
                          <h4 className="font-bold text-base">{team.name}</h4>
                          <p className="text-sm text-muted-foreground">{team.projectTitle || 'No project title'}</p>
                          <p className="text-xs mt-1 font-medium">{team.memberCount} members</p>
                          {pendingRequestByTeam.has(team.id) && (
                            <Badge variant="secondary" className="mt-2">
                              Request sent to {pendingRequestByTeam.get(team.id)?.supervisorName}
                            </Badge>
                          )}
                        </div>
                        
                        <Dialog open={assigningTeamId === team.id} onOpenChange={(open) => {
                          setAssigningTeamId(open ? team.id : null);
                          if (!open) form.reset();
                        }}>
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0 gap-2 cursor-pointer transition-colors hover:bg-muted/80"
                              disabled={pendingRequestByTeam.has(team.id)}
                            >
                              <UserPlus className="h-4 w-4" /> {pendingRequestByTeam.has(team.id) ? "Request Pending" : "Assign"}
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Assign Supervisor</DialogTitle>
                              <DialogDescription>
                                Select a faculty member to supervise <strong>{team.name}</strong>.
                              </DialogDescription>
                            </DialogHeader>
                            <Form {...form}>
                              <form onSubmit={form.handleSubmit(onAssign)} className="space-y-4">
                                <FormField
                                  control={form.control}
                                  name="supervisorId"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Supervisor</FormLabel>
                                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select a supervisor" />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                          {supervisors?.map(sup => {
                                            const workload = dashboard.supervisorWorkload.find(w => w.supervisor.id === sup.id);
                                            return (
                                              <SelectItem key={sup.id} value={sup.id.toString()}>
                                                {sup.name} ({workload?.teamCount || 0} teams)
                                              </SelectItem>
                                            );
                                          })}
                                        </SelectContent>
                                      </Select>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <DialogFooter>
                                  <Button type="button" variant="outline" className="cursor-pointer transition-colors hover:bg-muted/80" onClick={() => setAssigningTeamId(null)}>Cancel</Button>
                                  <Button type="submit" className="cursor-pointer transition-colors hover:opacity-90" disabled={assignSupervisor.isPending}>
                                    {assignSupervisor.isPending ? "Assigning..." : "Assign"}
                                  </Button>
                                </DialogFooter>
                              </form>
                            </Form>
                          </DialogContent>
                        </Dialog>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assigned" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserMinus className="h-5 w-5 text-primary" /> Assigned Teams
                </CardTitle>
                <CardDescription>Teams that currently have a supervisor assigned.</CardDescription>
              </CardHeader>
              <CardContent>
                {dashboardLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : !dashboard?.assignedTeamsList || dashboard.assignedTeamsList.length === 0 ? (
                  <div className="text-center p-6 border rounded-lg border-dashed">
                    <p className="text-muted-foreground">No teams currently have supervisors assigned.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {dashboard.assignedTeamsList.map(team => (
                      <div key={team.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between border rounded-lg p-4 gap-4">
                        <div>
                          <h4 className="font-bold text-base">{team.name}</h4>
                          <p className="text-sm text-muted-foreground">{team.projectTitle || 'No project title'}</p>
                          <p className="text-xs mt-1 font-medium">
                            Supervisor: {team.supervisor?.name || "Unknown"}
                          </p>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="shrink-0 gap-2 cursor-pointer transition-colors hover:bg-destructive/90"
                              disabled={removingTeamId === team.id}
                            >
                              <UserMinus className="h-4 w-4" />
                              {removingTeamId === team.id ? "Removing..." : "Remove"}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove Supervisor Assignment?</AlertDialogTitle>
                              <AlertDialogDescription>
                                You are about to remove <strong>{team.supervisor?.name || "the current supervisor"}</strong> from team <strong>{team.name}</strong>.
                                This will unassign the team and may affect who can view or submit tasks.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => handleRemoveSupervisor(team.id)}
                              >
                                Yes, remove supervisor
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="students" className="space-y-4 mt-6">
            <Card>
              <CardHeader className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <UserX className="h-5 w-5 text-primary" /> Students Without Team
                  </CardTitle>
                  <CardDescription>Students who have not joined any team yet.</CardDescription>
                </div>
                <div className="shrink-0">
                  <Button size="sm" variant="outline" onClick={handleCreateGenderTeams} disabled={creatingGenderTeams}>
                    {creatingGenderTeams ? "Creating..." : "Create teams by gender"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {dashboardLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : !dashboard?.studentsWithoutTeamsList || dashboard.studentsWithoutTeamsList.length === 0 ? (
                  <div className="text-center p-6 border rounded-lg border-dashed">
                    <p className="text-muted-foreground">All students have joined a team.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {studentsGrouped.female.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Female Students</p>
                        <div className="space-y-3">
                          {studentsGrouped.female.map((student: any) => (
                                    <div key={student.id} className="flex items-center justify-between border rounded-lg p-4">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                                  {student.name?.charAt(0).toUpperCase() || "?"}
                                </div>
                                <div>
                                  <p className="font-medium text-sm">{student.name || "Unknown"}</p>
                                  <p className="text-xs text-muted-foreground">{student.email}</p>
                                  <div className="mt-1">
                                    {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
                                    {/* @ts-ignore */}
                                    <StudentIdBadge userId={student.id} />
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" variant="ghost" onClick={() => openAssignStudentDialog(student.id)}>Assign</Button>
                                <Button size="sm" variant="outline" onClick={() => handleAddUserByGender(student.id)}>Add to gender team</Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {studentsGrouped.male.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Male Students</p>
                        <div className="space-y-3">
                          {studentsGrouped.male.map((student: any) => (
                            <div key={student.id} className="flex items-center justify-between border rounded-lg p-4">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                                  {student.name?.charAt(0).toUpperCase() || "?"}
                                </div>
                                <div>
                                  <p className="font-medium text-sm">{student.name || "Unknown"}</p>
                                  <p className="text-xs text-muted-foreground">{student.email}</p>
                                  <div className="mt-1">
                                    {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
                                    {/* @ts-ignore */}
                                    <StudentIdBadge userId={student.id} />
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" variant="ghost" onClick={() => openAssignStudentDialog(student.id)}>Assign</Button>
                                <Button size="sm" variant="outline" onClick={() => handleAddUserByGender(student.id)}>Add to gender team</Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {studentsGrouped.unknown.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Unspecified Gender</p>
                        <div className="space-y-3">
                          {studentsGrouped.unknown.map((student: any) => (
                            <div key={student.id} className="flex items-center justify-between border rounded-lg p-4">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                                  {student.name?.charAt(0).toUpperCase() || "?"}
                                </div>
                                <div>
                                  <p className="font-medium text-sm">{student.name || "Unknown"}</p>
                                  <p className="text-xs text-muted-foreground">{student.email}</p>
                                  <div className="mt-1">
                                    {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
                                    {/* @ts-ignore */}
                                    <StudentIdBadge userId={student.id} />
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" variant="ghost" onClick={() => openAssignStudentDialog(student.id)}>Assign</Button>
                                <Button size="sm" variant="outline" onClick={() => handleAddUserByGender(student.id)}>Add to gender team</Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={assignStudentDialogOpen} onOpenChange={(open) => setAssignStudentDialogOpen(open)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign student to team</DialogTitle>
              <DialogDescription>Select a team to add the student to.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Select onValueChange={(v) => setAssignSelectedTeamId(v)} defaultValue={assignSelectedTeamId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {dashboard?.allTeamsList?.map((team: any) => (
                    <SelectItem key={team.id} value={String(team.id)}>
                      {team.name} ({team.memberCount} members)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAssignStudentDialogOpen(false)}>Cancel</Button>
                <Button onClick={() => handleAssignStudentToTeam(Number(assignSelectedTeamId))} disabled={!assignSelectedTeamId}>Assign</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" /> System Activity Log
                </CardTitle>
                <CardDescription>Recent events from your coordinator actions only.</CardDescription>
              </CardHeader>
              <CardContent>
                {logsLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : !logs || logs.length === 0 ? (
                  <p className="text-center text-muted-foreground p-4">No activity logs available.</p>
                ) : (
                  <div className="space-y-4">
                    {logs.slice(0, 20).map(log => (
                      <div key={log.id} className="flex gap-4 border-b pb-4 last:border-0 last:pb-0">
                        <div className="mt-0.5">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{log.description}</p>
                          <div className="flex gap-2 mt-1">
                            <span className="text-xs text-muted-foreground">{format(new Date(log.createdAt), 'MMM d, yyyy h:mm a')}</span>
                                {log.user && (
                              <span className="text-xs text-muted-foreground">• {log.user.name}
                                {/* show student id if available in profile */}
                                {log.user.id ? (
                                  <span className="inline-flex items-center">&nbsp;•&nbsp;<StudentIdBadge userId={log.user.id} /></span>
                                ) : null}
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] uppercase">{log.action}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" /> Supervisor Workload
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dashboardLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : !dashboard?.supervisorWorkload || dashboard.supervisorWorkload.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center">No supervisors available.</p>
                ) : (
                  <div className="space-y-3">
                    {dashboard.supervisorWorkload.map(item => (
                      <div key={item.supervisor.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                            {item.supervisor.name.charAt(0)}
                          </div>
                          <span className="text-sm font-medium">{item.supervisor.name}</span>
                        </div>
                        <Badge variant={item.teamCount > 3 ? "destructive" : "secondary"}>
                          {item.teamCount} teams
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-primary" /> All Teams
            </CardTitle>
            <CardDescription>Complete list of teams in the system.</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboardLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : !dashboard?.allTeamsList || dashboard.allTeamsList.length === 0 ? (
              <div className="text-center p-6 border rounded-lg border-dashed">
                <p className="text-muted-foreground">No teams found.</p>
              </div>
            ) : (
              <ScrollArea className="h-96 pr-4">
                <div className="space-y-3">
                  {dashboard.allTeamsList.map((team) => (
                    <div key={team.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h4 className="font-semibold">{team.name}</h4>
                        <p className="text-sm text-muted-foreground">{team.projectTitle || "No project title"}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                          Leader: {team.leader?.name || "Unknown"}
                          {team.leader?.id ? (
                            <span className="inline-flex items-center">&nbsp;•&nbsp;<StudentIdBadge userId={team.leader.id} /></span>
                          ) : null} • {team.memberCount} members
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {team.supervisor ? (
                          <Badge variant="secondary">{team.supervisor.name}</Badge>
                        ) : (
                          <Badge variant="outline">Unassigned</Badge>
                        )}
                        <Badge variant="outline" className="capitalize">
                          {team.currentPhase || team.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card> */}
      </div>
    </AppLayout>
  );
}