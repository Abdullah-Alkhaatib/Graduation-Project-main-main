import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { 
  useGetMyTeam, 
  getGetMyTeamQueryKey, 
  useUpdateTeam, 
  useLeaveTeam,
  useCreateTeam,
  TeamStatus
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Briefcase, Activity, Settings, LogOut, ArrowRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const updateTeamSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  projectTitle: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

type UpdateTeamValues = z.infer<typeof updateTeamSchema>;

export default function MyTeam() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const myTeamQueryKey = [...getGetMyTeamQueryKey(), user?.id ?? "anonymous"];

  const { data: team, isLoading, isError, error } = useGetMyTeam({
    query: {
      queryKey: myTeamQueryKey,
      retry: false,
      enabled: Boolean(user?.id),
    }
  });

  const updateTeam = useUpdateTeam();
  const leaveTeam = useLeaveTeam();
  const createTeam = useCreateTeam();

  const form = useForm<UpdateTeamValues>({
    resolver: zodResolver(updateTeamSchema),
    defaultValues: {
      name: "",
      projectTitle: "",
      description: "",
    },
  });

  const createTeamSchema = updateTeamSchema.extend({ publishAd: z.boolean().optional() });
  type CreateTeamValues = z.infer<typeof createTeamSchema>;

  const createForm = useForm<CreateTeamValues>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: {
      name: "",
      projectTitle: "",
      description: "",
      publishAd: false,
    },
  });

  const handleCreate = async (data: CreateTeamValues) => {
    try {
      const status = data.publishAd ? ("forming" as const) : ("active" as const);
      await createTeam.mutateAsync({ data: { name: data.name, projectTitle: data.projectTitle, description: data.description, status } });
      queryClient.invalidateQueries({ queryKey: myTeamQueryKey });
      queryClient.invalidateQueries({ queryKey: getGetMyTeamQueryKey() });
      setIsCreateOpen(false);
      createForm.reset();
      toast({ title: "Team Created", description: "Your team has been created." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create team.", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (team) {
      form.reset({
        name: team.name,
        projectTitle: team.projectTitle || "",
        description: team.description || "",
      });
    }
  }, [team, form]);

  const handleUpdate = async (data: UpdateTeamValues) => {
    if (!team) return;
    try {
      await updateTeam.mutateAsync({ 
        id: team.id,
        data 
      });
      queryClient.invalidateQueries({ queryKey: myTeamQueryKey });
      setIsEditOpen(false);
      toast({
        title: "Team Updated",
        description: "Your team details have been updated.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update team.",
        variant: "destructive",
      });
    }
  };

  const handleLeave = async () => {
    if (!team) return;
    try {
      await leaveTeam.mutateAsync({ id: team.id });
      queryClient.removeQueries({ queryKey: getGetMyTeamQueryKey(), exact: false });
      queryClient.invalidateQueries({ queryKey: getGetMyTeamQueryKey() });
      toast({
        title: "Team Left",
        description: "You have left the team.",
      });
      // setLocation("/teams");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to leave team.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <AppLayout title="My Team">
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-1/3 mb-2" />
              <Skeleton className="h-4 w-1/4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (!team || isError) {
    const message = (error as any)?.message;
    return (
      <AppLayout title="My Team">
        <div className="flex flex-col items-center justify-center p-12 text-center bg-card rounded-lg border border-dashed mt-8">
          <Users className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-2xl font-bold tracking-tight">You don't have a team yet</h2>
          <p className="text-muted-foreground max-w-md mt-2 mb-6">
            {message && !String(message).toLowerCase().includes("not in a team")
              ? message
              : "Join an existing team or create a new one to start your graduation project journey."}
          </p>
          <div className="flex gap-4">
            <Button asChild>
              <Link href="/teams">Team Board</Link>
            </Button>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Create Team</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Team</DialogTitle>
                  <DialogDescription>
                    Describe your graduation project and set yourself as the team leader.
                  </DialogDescription>
                </DialogHeader>
                <Form {...createForm}>
                  <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4">
                    <FormField
                      control={createForm.control}
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
                      control={createForm.control}
                      name="projectTitle"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Project Title</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. AI-powered Grading System" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description (Optional)</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Explain the project and the roles you need..." {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* <FormField
                      control={createForm.control}
                      name="publishAd"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start gap-3">
                          <FormControl>
                            <Checkbox checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(Boolean(v))} />
                          </FormControl>
                          <div className="space-y-0">
                            <FormLabel className="mb-0!">Post advertisement on Team Board</FormLabel>
                            <FormDescription className="text-sm text-muted-foreground">If checked, your team will appear on the Team Board as an open ad.</FormDescription>
                          </div>
                        </FormItem>
                      )}
                    /> */}

                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={createTeam.isPending}>{createTeam.isPending ? "Saving..." : "Create Team"}</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </AppLayout>
    );
  }

  const isLeader = team.leaderId === user?.id;

  return (
    <AppLayout title="My Team">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold tracking-tight">My Team</h2>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/teams/${team.id}`}>View Public Profile</Link>
            </Button>
            {isLeader && (
              <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Settings className="h-4 w-4" /> Edit Team
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit Team Details</DialogTitle>
                    <DialogDescription>
                      Update your team's public information.
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleUpdate)} className="space-y-4 py-4">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Team Name</FormLabel>
                            <FormControl>
                              <Input {...field} />
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
                              <Input {...field} value={field.value || ''} />
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
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                              <Textarea {...field} value={field.value || ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={updateTeam.isPending}>
                          {updateTeam.isPending ? "Saving..." : "Save Changes"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            )}
            <Button variant="destructive" className="gap-2" onClick={handleLeave} disabled={leaveTeam.isPending}>
              <LogOut className="h-4 w-4" /> Leave Team
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-2xl">{team.name}</CardTitle>
                <CardDescription className="text-base mt-1 text-foreground font-medium">
                  {team.projectTitle || "No project title set"}
                </CardDescription>
              </div>
              <Badge variant={team.status === TeamStatus.completed ? "default" : "secondary"} className="capitalize text-sm px-3 py-1">
                {team.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Description</h4>
              <p className="text-sm">{team.description || "No description provided."}</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* <div className="rounded-lg border p-4 flex flex-col justify-center gap-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Activity className="h-4 w-4" />
                  <span className="text-sm font-medium">Current Phase</span>
                </div>
                <p className="text-lg font-bold capitalize">{team.currentPhase || "None"}</p>
                {team.currentPhase && (
                  <Button asChild variant="link" className="p-0 h-auto text-sm justify-start mt-1">
                    <Link href={`/tasks?phase=${team.currentPhase}`}>View Tasks <ArrowRight className="h-3 w-3 ml-1" /></Link>
                  </Button>
                )}
              </div> */}
              
              <div className="rounded-lg border p-4 flex flex-col justify-center gap-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Briefcase className="h-4 w-4" />
                  <span className="text-sm font-medium">Supervisor</span>
                </div>
                <p className="text-lg font-bold">{team.supervisor?.name || "Unassigned"}</p>
                <Button asChild variant="link" className="p-0 h-auto text-sm justify-start mt-1">
                  <Link href="/supervisor-requests">Manage Requests <ArrowRight className="h-3 w-3 ml-1" /></Link>
                </Button>
              </div>

              <div className="rounded-lg border p-4 flex flex-col justify-center gap-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span className="text-sm font-medium">Team Members</span>
                </div>
                <p className="text-lg font-bold">{team.memberCount} members</p>
                <Button asChild variant="link" className="p-0 h-auto text-sm justify-start mt-1">
                  <Link href={`/teams/${team.id}`}>Manage Members <ArrowRight className="h-3 w-3 ml-1" /></Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}