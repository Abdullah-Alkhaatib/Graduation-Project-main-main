import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import {
  getGetMyTeamQueryKey,
  getGetSupervisorDashboardQueryKey,
  getGetCoordinatorDashboardQueryKey,
  getListTeamsQueryKey,
  getListProfilesQueryKey,
  TeamStatus,
  useCreateTeam,
  useGetMyTeam,
  useGetSupervisorDashboard,
  useGetCoordinatorDashboard,
  useListTeams,
  useListProfiles,
  useSendInvitation,
  useUpdateTeam,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { BadgePlus, Briefcase, Search, Sparkles, Users, UserRoundSearch } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const createTeamSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  projectTitle: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

type CreateTeamValues = z.infer<typeof createTeamSchema>;

export default function Teams() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false);
  const [quickPostMode, setQuickPostMode] = useState<"team" | "student">("team");
  const [joiningTeamId, setJoiningTeamId] = useState<number | null>(null);
  const [teamSupervisorFilter, setTeamSupervisorFilter] = useState<"all" | "assigned" | "unassigned">("all");
  const [supervisorFilter, setSupervisorFilter] = useState<string>("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: teams, isLoading } = useListTeams({
    search: search || undefined,
  }, {
    query: {
          queryKey: '/api/teams',
    }
  });

  const { data: studentProfiles, isLoading: isProfilesLoading } = useListProfiles({
    search: search || undefined,
  }, {
    query: {
      queryKey: getListProfilesQueryKey({ search: search || undefined }),
    },
  });

  const [announcements, setAnnouncements] = useState<any[]>([]);

  const fetchAnnouncements = async () => {
    try {
      const res = await fetch(`/api/team-announcements`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setAnnouncements(Array.isArray(json) ? json : []);
      }
    } catch (e) {
      // ignore
    }
  };

  // load announcements on mount
  useEffect(() => { fetchAnnouncements(); }, []);

  const teamsList = Array.isArray(teams) ? teams : [];
  const visibleTeamsFromTeams = teamsList.filter((team) => team.status === TeamStatus.forming);
  const visibleAnnouncements = announcements.map((a) => ({
    id: `ann-${a.id}`,
    name: a.title,
    projectTitle: null,
    description: a.description,
    status: TeamStatus.forming,
    leader: a.leader || null,
    memberCount: 0,
    isAnnouncement: true,
    teamId: a.teamId || null,
    leaderId: a.leaderId || null,
  }));
  const leaderAnnouncements = visibleAnnouncements.filter((announcement) => announcement.teamId !== null);
  const studentAnnouncements = visibleAnnouncements.filter((announcement) => announcement.teamId === null);

  const getOwnerName = (announcement: any) => {
    // try embedded leader object first
    if (announcement.leader && announcement.leader.name) return announcement.leader.name;
    // fall back to profiles list
    const profile = studentProfilesList.find((p) => p.userId === announcement.leaderId || p.user?.id === announcement.leaderId);
    if (profile) return profile.user?.name || profile.userName || "Unknown";
    return announcement.leaderId ? `User ${announcement.leaderId}` : "Unknown";
  };

  const myTeamQueryKey = [...getGetMyTeamQueryKey(), user?.id ?? "anonymous"];
  const { data: myTeam } = useGetMyTeam({
    query: {
      queryKey: myTeamQueryKey,
      retry: false,
      enabled: Boolean(user?.id),
    },
  });

  const supervisorDashboardQueryKey = getGetSupervisorDashboardQueryKey();
  const { data: supervisorDashboard, isLoading: supervisorDashboardLoading } = useGetSupervisorDashboard({
    query: {
      queryKey: supervisorDashboardQueryKey,
      enabled: user?.role === "supervisor",
      retry: false,
    },
  });

  const coordinatorDashboardQueryKey = getGetCoordinatorDashboardQueryKey();
  const { data: coordinatorDashboard, isLoading: coordinatorDashboardLoading } = useGetCoordinatorDashboard({
    query: {
      queryKey: coordinatorDashboardQueryKey,
      enabled: user?.role === "coordinator",
      retry: false,
    },
  });

  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const sendInvitation = useSendInvitation();
  const [sentInvites, setSentInvites] = useState<string[]>([]);
  const form = useForm<CreateTeamValues>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: {
      name: "",
      projectTitle: "",
      description: "",
    },
  });

  const isLeader = Boolean(myTeam && myTeam.leaderId === user?.id);
  const isMyTeamOpen = Boolean(myTeam && myTeam.status === TeamStatus.forming);
  const studentProfilesList = Array.isArray(studentProfiles) ? studentProfiles : [];

  useEffect(() => {
    if (isLeader && myTeam) {
      form.reset({
        name: myTeam.name,
        projectTitle: myTeam.projectTitle || "",
        description: myTeam.description || "",
      });
      return;
    }

    if (!myTeam) {
      form.reset({
        name: "",
        projectTitle: "",
        description: "",
      });
    }
  }, [form, isLeader, myTeam]);

  const handleJoinRequest = async (teamId: number) => {
    setJoiningTeamId(teamId);

    try {
      const response = await fetch(`/api/teams/${teamId}/join-request`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || payload?.message || "Failed to send join request.");
      }

      toast({
        title: "Request sent",
        description: "The team leader has been notified about your request.",
      });
    } catch (error: any) {
      toast({
        title: "Could not send request",
        description: error.message || "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setJoiningTeamId(null);
    }
  };

  const handleInviteStudent = async (studentId: string) => {
    if (!myTeam || !isLeader) return;

    try {
      await sendInvitation.mutateAsync({ data: { teamId: myTeam.id, studentId } });
      setSentInvites((s) => [...s, studentId]);
      toast({ title: "Invitation sent", description: "Team members were notified to approve or reject this invitation." });
    } catch (error: any) {
      toast({
        title: "Could not send invitation",
        description: error.message || "Please try again later.",
        variant: "destructive",
      });
    }
  };

  const onSubmit = async (data: CreateTeamValues) => {
    try {
      if (isLeader && myTeam) {
        await updateTeam.mutateAsync({
          id: myTeam.id,
          data,
        });
            queryClient.invalidateQueries('/api/teams');
      } else {
        await createTeam.mutateAsync({ data });
        queryClient.invalidateQueries('/api/teams');
        queryClient.invalidateQueries({ queryKey: myTeamQueryKey });
      }
      setIsDialogOpen(false);
      form.reset();
      toast({
        title: isLeader ? "Announcement updated" : "Team created",
        description: isLeader
          ? "Your team announcement has been updated successfully."
          : "Your team has been created successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || (isLeader ? "Failed to update announcement." : "Failed to create team."),
        variant: "destructive",
      });
    }
  };

  // Quick create form for posting a small ad (title + description) without modal
  const quickCreateSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    description: z.string().optional().nullable(),
  });
  type QuickCreateValues = z.infer<typeof quickCreateSchema>;
  const quickForm = useForm<QuickCreateValues>({ resolver: zodResolver(quickCreateSchema), defaultValues: { name: "", description: "" } });

  const handleQuickCreate = async (data: QuickCreateValues) => {
    try {
      // Quick Post should only create an announcement and must NOT modify teams
      const payload = {
        title: data.name,
        description: data.description ?? null,
        teamId: isLeader && myTeam ? myTeam.id : null,
      } as any;

      const res = await fetch(`/api/team-announcements`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || body?.message || "Failed to post announcement.");
      }

      await fetchAnnouncements();
      quickForm.reset();
      setIsQuickCreateOpen(false);
      toast({
        title: quickPostMode === "team" ? "Team post posted" : "Student post posted",
        description: "Your ad is now visible on Team Board.",
      });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to post ad.", variant: "destructive" });
    }
  };

  const handleDeleteAnnouncement = async (annId: number) => {
    try {
      const res = await fetch(`/api/team-announcements/${annId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || body?.message || "Failed to delete announcement.");
      }

      await fetchAnnouncements();
      toast({ title: "Deleted", description: "Announcement deleted successfully." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to delete announcement.", variant: "destructive" });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case TeamStatus.forming:
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 hover:bg-yellow-50">Open for members</Badge>;
      case TeamStatus.active:
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 hover:bg-blue-50">Active team</Badge>;
      case TeamStatus.supervised:
        return <Badge variant="outline" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-50">Supervised</Badge>;
      case TeamStatus.completed:
        return <Badge variant="outline" className="bg-green-50 text-green-700 hover:bg-green-50">Completed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const isSupervisor = user?.role === "supervisor";
  const isStudent = user?.role === "student";
  const isCoordinator = user?.role === "coordinator";

  if (isSupervisor) {
    const assignedTeams = supervisorDashboard?.teams ?? [];

    return (
      <AppLayout title="My Teams">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">My Teams</h2>
              <p className="text-muted-foreground">Teams assigned to you as supervisor.</p>
            </div>
            <div className="rounded-lg border bg-card px-4 py-2 text-sm text-muted-foreground">
              {supervisorDashboard?.assignedTeams ?? 0} assigned teams
            </div>
          </div>

          {supervisorDashboardLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-2/3 mb-2" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-4 w-5/6" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : assignedTeams.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card p-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No teams assigned yet</h3>
              <p className="text-muted-foreground mt-1 max-w-sm">
                Once a coordinator assigns teams to you, they will appear here only.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {assignedTeams.map((team) => (
                <Card key={team.id} className="flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <CardTitle className="line-clamp-1 pb-3">{team.name}</CardTitle>
                        <CardDescription className="line-clamp-1 font-medium text-foreground">
                          {team.projectTitle || "No project title"}
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className="bg-background/80 text-foreground capitalize">
                        {team.currentPhase || team.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2">
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {team.description || "No description provided."}
                    </p>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>{team.memberCount} members</span>
                      <span>Leader: {team.leader?.name || "Unknown"}</span>
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Button asChild variant="secondary" className="w-full">
                      <Link href={`/teams/${team.id}`}>Open Team</Link>
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      </AppLayout>
    );
  }

  if (isCoordinator) {
    const allTeams = coordinatorDashboard?.allTeamsList ?? [];

  const supervisorOptions = useMemo(() => {
    const supervisors = allTeams
      .map((team) => team.supervisor)
      .filter((sup): sup is { id: number; name: string } => Boolean(sup))
      .reduce<Map<number, { id: number; name: string }>>((map, sup) => {
        if (!map.has(sup.id)) map.set(sup.id, sup);
        return map;
      }, new Map());
    return Array.from(supervisors.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allTeams]);

  const filteredAllTeams = useMemo(() => {
    return allTeams.filter((team) => {
      if (teamSupervisorFilter === "assigned" && !team.supervisor) {
        return false;
      }
      if (teamSupervisorFilter === "unassigned" && team.supervisor) {
        return false;
      }
      if (supervisorFilter && team.supervisor?.id !== Number(supervisorFilter)) {
        return false;
      }
      return true;
    });
  }, [allTeams, teamSupervisorFilter, supervisorFilter]);

    return (
      <AppLayout title="All Teams">
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">All Teams</h2>
                <p className="text-muted-foreground">Complete overview of all teams in the system.</p>
              </div>
              <div className="rounded-lg border bg-card px-4 py-2 text-sm text-muted-foreground">
                {filteredAllTeams.length} / {allTeams.length} teams shown
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="teamSupervisorFilter" className="text-sm font-medium text-muted-foreground">
                  Filter by Team Status
                </label>
                <select
                  id="teamSupervisorFilter"
                  value={teamSupervisorFilter}
                  onChange={(e) => setTeamSupervisorFilter(e.target.value as "all" | "assigned" | "unassigned")}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
                >
                  <option value="all">All Teams</option>
                  <option value="assigned">Supervised Teams</option>
                  <option value="unassigned">Unassigned Teams</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="supervisorFilter" className="text-sm font-medium text-muted-foreground">
                  Filter by Supervisor
                </label>
                <select
                  id="supervisorFilter"
                  value={supervisorFilter}
                  onChange={(e) => setSupervisorFilter(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
                >
                  <option value="">All Supervisors</option>
                  {supervisorOptions.map((sup) => (
                    <option key={sup.id} value={sup.id}>{sup.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {coordinatorDashboardLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-2/3 mb-2" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-4 w-5/6" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filteredAllTeams.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card p-12 text-center">
              <Briefcase className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No teams match the filters</h3>
              <p className="text-muted-foreground mt-1 max-w-sm">
                Adjust the supervisor or registration filter to see matching teams.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredAllTeams.map((team) => (
                <Card key={team.id} className="flex flex-col hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1">
                        <CardTitle className="line-clamp-1 text-base">{team.name}</CardTitle>
                        <CardDescription className="line-clamp-1 font-medium text-foreground mt-1">
                          {team.projectTitle || "No project title"}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-3">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Leader:</span>
                        <span className="font-medium">{team.leader?.name || "Unknown"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Members:</span>
                        <span className="font-medium">{team.memberCount}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2 flex-wrap">
                      {team.supervisor ? (
                        <Badge variant="secondary" className="text-xs">{team.supervisor.name}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">Unassigned</Badge>
                      )}
                      <Badge variant="outline" className="capitalize text-xs">
                        {team.currentPhase || team.status}
                      </Badge>
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Button asChild variant="secondary" className="w-full text-xs">
                      <Link className={"text-[14px]"} href={`/teams/${team.id}`}>View Team</Link>
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={isSupervisor ? "My Teams" : "Team Board"}>
      <div className="space-y-6">
        {/* <div className="rounded-2xl border bg-linear-to-br from-primary/10 via-background to-amber-50 p-6 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-center">
            <div className="space-y-4">
              <Badge variant="outline" className="w-fit gap-2 bg-background/80 text-foreground">
                <Sparkles className="h-3.5 w-3.5" /> Team matching board
              </Badge>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Teams looking for members appear here, and leaders can post their announcement from this page.
                </h1>
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  Team leaders can publish or update a short ad with the project details and the skills they want from applicants.
                  Students can browse those open ads and request to join the one that matches them.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border bg-background/80 px-3 py-1">Leaders: publish a team announcement.</span>
                <span className="rounded-full border bg-background/80 px-3 py-1">Students: request to join an open ad.</span>
                <span className="rounded-full border bg-background/80 px-3 py-1">Leaders: invite students from the student ads section.</span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Card className="border-dashed bg-background/85">
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <BadgePlus className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">Team leaders</p>
                    <p className="text-sm text-muted-foreground">Add the project description and the skills you want from applicants.</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-dashed bg-background/85">
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <UserRoundSearch className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">Students without a team</p>
                    <p className="text-sm text-muted-foreground">Browse the open ads and request to join the one that matches you.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div> */}
        {isQuickCreateOpen && (
          <Card className="p-4">
            <Form {...quickForm}>
              <form onSubmit={quickForm.handleSubmit(handleQuickCreate)} className="space-y-3">
                <FormField
                  control={quickForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{quickPostMode === "team" ? "Team Post Title" : "Student Post Title"}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={quickPostMode === "team" ? "e.g. Looking for frontend dev" : "e.g. Need teammates for project"} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={quickForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (optional)</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder={quickPostMode === "team" ? "Short description for students" : "Short description about your skills or what you need"} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => { quickForm.reset(); setIsQuickCreateOpen(false); }}>Cancel</Button>
                  <Button type="submit" disabled={createTeam.isPending}>{createTeam.isPending ? "Posting..." : (quickPostMode === "team" ? "Quick Post Team" : "Quick Post Student")}</Button>
                </div>
              </form>
            </Form>
          </Card>
        )}

        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search team posts, project titles, or leaders..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          
          {isLeader && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setQuickPostMode("team");
                  setIsQuickCreateOpen(v => !v);
                }}
              >
                Quick Post Team
              </Button>
            </div>
          )}
          {isStudent && !myTeam && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setQuickPostMode("student");
                  setIsQuickCreateOpen(v => !v);
                }}
              >
                Quick Post Student
              </Button>
            </div>
          )}
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-106.25">
            <DialogHeader>
              <DialogTitle>{isLeader ? "Post / Edit Announcement" : "Post Team Ad"}</DialogTitle>
              <DialogDescription>
                {isLeader
                  ? "Update your team's public announcement and describe the skills you want from students who apply."
                  : "Describe your graduation project and mention the skills you still need. You will be set as the team leader."}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Team / Ad Title</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Code Ninjas" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="projectTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Title</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. AI-powered Grading System, needs React and UI/UX" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (Optional)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Explain the project, the missing roles, and the skills you want from applicants..." {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isLeader ? updateTeam.isPending : createTeam.isPending}>
                    {(isLeader ? updateTeam.isPending : createTeam.isPending) ? "Saving..." : (isLeader ? "Save Announcement" : "Post Team Ad")}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-5/6" />
                </CardContent>
                <CardFooter>
                  <Skeleton className="h-9 w-full" />
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : leaderAnnouncements.length === 0 && studentAnnouncements.length === 0 && visibleTeamsFromTeams.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center bg-card rounded-lg border border-dashed">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No team posts found</h3>
            <p className="text-muted-foreground max-w-sm mt-1">
              {search
                ? "No team posts match your search criteria."
                : isSupervisor
                  ? "You are not assigned to any team yet."
                  : "There are no open team announcements yet."}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <section className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Team Leader Posts</h2>
                {/* <p className="text-sm text-muted-foreground">Announcements posted by team leaders for their teams.</p> */}
              </div>
              {leaderAnnouncements.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
                  No leader posts yet.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {leaderAnnouncements.map((team) => (
                    <Card key={team.id} className="flex flex-col">
                      <CardHeader className="pb-3">
                        <div className="flex justify-between items-start gap-4">
                            <div className="flex flex-col">
                              {/* <span className="text-sm text-muted-foreground pb-3">{getOwnerName(team)}</span> */}
                              <CardTitle className="line-clamp-1 mt-1">{team.name}</CardTitle>
                            </div>
                            <div className="shrink-0">
                              <Badge variant="outline" className="bg-background/80 text-foreground">{getOwnerName(team)}</Badge>
                            </div>
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1 pb-4">
                        <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                          {team.description || "No description provided."}
                        </p>
                      </CardContent>
                      <CardFooter className="pt-0">
                        <div className="flex w-full gap-2">
                          {isStudent && !myTeam && team.leaderId !== user?.id && team.teamId && (
                            <Button
                              type="button"
                              className="flex-1"
                              onClick={() => handleJoinRequest(Number(team.teamId))}
                              disabled={joiningTeamId === Number(team.teamId) || team.status === TeamStatus.completed}
                            >
                              {joiningTeamId === Number(team.teamId) ? "Sending..." : "Request to Join"}
                            </Button>
                          )}

                          {team.leaderId === user?.id ? (
                            <Button
                              type="button"
                              variant="destructive"
                              className={isStudent && team.leaderId !== user?.id ? "" : "w-full"}
                              onClick={() => handleDeleteAnnouncement(parseInt(team.id.replace('ann-', '')))}
                            >
                              Delete Post
                            </Button>
                          ) : null}
                        </div>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Students Looking for Team</h2>
                {/* <p className="text-sm text-muted-foreground">Posts from students without a team who want to join one.</p> */}
              </div>
              {studentAnnouncements.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
                  No student posts yet.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {studentAnnouncements.map((team) => (
                    <Card key={team.id} className="flex flex-col">

                      <CardHeader className="pb-3">
                        <div className="flex justify-between items-start gap-4">
                            <div className="flex flex-col">
                              {/* <span className="text-sm text-muted-foreground pb-3">{getOwnerName(team)}</span> */}
                              <CardTitle className="line-clamp-1 mt-1">{team.name}</CardTitle>
                            </div>
                            <div className="shrink-0">
                              <Badge variant="outline" className="bg-background/80 text-foreground">{getOwnerName(team)}</Badge>
                            </div>
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1 pb-4">
                        <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                          {team.description || "No description provided."}
                        </p>
                      </CardContent>
                      <CardFooter className="pt-0">
                        <div className="flex w-full gap-2">
                          {team.leaderId === user?.id ? (
                            <Button
                              type="button"
                              variant="destructive"
                              className="w-full"
                              onClick={() => handleDeleteAnnouncement(parseInt(team.id.replace('ann-', '')))}
                            >
                              Delete Post
                            </Button>
                          ) : null}

                          {isLeader && team.leaderId !== user?.id && (
                            (() => {
                              const profile = studentProfilesList.find((p) => p.userId === team.leaderId || p.user?.id === team.leaderId);
                              const sid = profile?.studentId || null;
                              const alreadySent = sid ? sentInvites.includes(String(sid)) : false;
                              const disabled = !sid || !myTeam || alreadySent || sendInvitation.isPending;
                              return (
                                <Button
                                  type="button"
                                  className="w-full"
                                  onClick={() => sid && handleInviteStudent(String(sid))}
                                  disabled={disabled}
                                >
                                  {alreadySent ? "Invitation Sent" : disabled ? "Cannot invite" : "Invite To My Team"}
                                </Button>
                              );
                            })()
                          )}
                        </div>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* <section className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Open Teams</h2>
                <p className="text-sm text-muted-foreground">Teams currently looking for members.</p>
              </div>
              {visibleTeamsFromTeams.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
                  No open teams at the moment.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {visibleTeamsFromTeams.map((team) => (
                    <Card key={team.id} className="flex flex-col">
                      <CardHeader className="pb-3">
                        <div className="flex justify-between items-start gap-4">
                          <CardTitle className="line-clamp-1">{team.name}</CardTitle>
                          {getStatusBadge(team.status)}
                        </div>
                        <CardDescription className="line-clamp-1 font-medium text-foreground">
                          {team.projectTitle || "No project title"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1 pb-4">
                        <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                          {team.description || "No description provided."}
                        </p>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground mt-auto">
                          <div className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            <span>{team.memberCount} members</span>
                          </div>
                          {team.supervisorId && (
                            <div className="flex items-center gap-1">
                              <Briefcase className="h-4 w-4" />
                              <span className="truncate max-w-30">{team.supervisor?.name}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                      <CardFooter className="pt-0">
                        <div className="flex w-full gap-2">
                          {isStudent && !myTeam && team.leaderId !== user?.id && (
                            <Button
                              type="button"
                              className="flex-1"
                              onClick={() => handleJoinRequest(team.id)}
                              disabled={joiningTeamId === team.id || team.status === TeamStatus.completed}
                            >
                              {joiningTeamId === team.id ? "Sending..." : "Request to Join"}
                            </Button>
                          )}
                          {isLeader && team.leaderId === user?.id && (
                            <Button type="button" className="flex-1" onClick={() => setIsDialogOpen(true)}>
                              Edit Announcement
                            </Button>
                          )}
                          <Button asChild variant={isStudent ? "secondary" : "default"} className="flex-1">
                            <Link href={`/teams/${team.id}`}>View Details</Link>
                          </Button>
                        </div>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </section> */}
          </div>
        )}

        {/* <div className="space-y-4 pt-2">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Student Ads</h2>
            <p className="text-sm text-muted-foreground">
              Students can publish their skills here, and leaders can invite the ones that fit their team.
            </p>
          </div>

          {isProfilesLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4 mb-2" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-4 w-5/6" />
                  </CardContent>
                  <CardFooter>
                    <Skeleton className="h-9 w-full" />
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : studentProfilesList.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-10 text-center bg-card rounded-lg border border-dashed">
              <UserRoundSearch className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No student ads found</h3>
              <p className="text-muted-foreground max-w-sm mt-1">
                {search
                  ? "No student ads match your search criteria."
                  : "No students have posted their skills yet."}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {studentProfilesList.map((profile) => (
                <Card key={profile.id} className="flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-4">
                      <CardTitle className="line-clamp-1">{profile.user.name}</CardTitle>
                      <Badge variant="outline" className="bg-slate-50 text-slate-700 hover:bg-slate-50">
                        Student Ad
                      </Badge>
                    </div>
                    <CardDescription className="line-clamp-1 font-medium text-foreground">
                      {profile.studentId || "Student profile"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 pb-4 space-y-3">
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {profile.description || "This student has not added a personal description yet."}
                    </p>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="font-medium text-foreground">Skills: </span>
                        <span className="text-muted-foreground">{profile.skills || "No skills listed yet."}</span>
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Interests: </span>
                        <span className="text-muted-foreground">{profile.interests || "No interests listed yet."}</span>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <div className="flex w-full gap-2">
                      {isLeader && myTeam && myTeam.leaderId === user?.id && (
                        <Button
                          type="button"
                          className="flex-1"
                          onClick={() => handleInviteStudent(profile.studentId || "")}
                          disabled={sendInvitation.isPending || myTeam.status === TeamStatus.completed}
                        >
                          {sendInvitation.isPending ? "Inviting..." : "Invite to Team"}
                        </Button>
                      )}
                      <Button asChild variant="secondary" className="flex-1">
                        <Link href={`/students?search=${encodeURIComponent(profile.user.name)}`}>View Profile</Link>
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div> */ }
      </div> 
    </AppLayout>
  );
}