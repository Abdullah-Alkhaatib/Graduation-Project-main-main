import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { 
  useListTasks, 
  getListTasksQueryKey, 
  useCreateTask, 
  TaskStatus,
  CreateTaskBodyPhase,
  useGetMyTeam,
  getGetMyTeamQueryKey,
  useGetSupervisorDashboard,
  getGetSupervisorDashboardQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { CheckSquare, Clock, ArrowRight, Calendar, Plus } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

const createTaskSchema = z.object({
  teamId: z.string().min(1, "Please select a team"),
  title: z.string().min(2, "Title is required"),
  description: z.string().optional(),
  deadline: z.string().optional(),
  phase: z.enum([CreateTaskBodyPhase.proposal, CreateTaskBodyPhase.progress, CreateTaskBodyPhase.final]),
});

export default function Tasks() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: myTeam } = useGetMyTeam({
    query: {
      enabled: user?.role === 'student',
      queryKey: getGetMyTeamQueryKey(),
    }
  });

  const studentHasSupervisor = user?.role !== 'student' || Boolean(myTeam?.supervisorId);

  const { data: supervisorDashboard } = useGetSupervisorDashboard({
    query: {
      enabled: user?.role === 'supervisor',
      queryKey: getGetSupervisorDashboardQueryKey(),
    }
  });

  const supervisorTeams = supervisorDashboard?.teams ?? [];
  const supervisorCanCreateTasks = user?.role === 'supervisor' && supervisorTeams.length > 0;

  // Filter tasks based on role.
  // Student: filter to their team.
  // Supervisor: they can see tasks for all their assigned teams. We'll just fetch all tasks.
  const { data: tasks, isLoading } = useListTasks({
    query: {
      queryKey: getListTasksQueryKey(),
      enabled: user?.role === 'supervisor' || (user?.role === 'student' && !!myTeam && studentHasSupervisor),
    }
  });

  const createTask = useCreateTask();

  const form = useForm<z.infer<typeof createTaskSchema>>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: {
      teamId: "",
      title: "",
      description: "",
      deadline: "",
      phase: CreateTaskBodyPhase.proposal,
    },
  });

  const onSubmit = async (data: z.infer<typeof createTaskSchema>) => {
    try {
      await createTask.mutateAsync({
        data: {
          teamId: parseInt(data.teamId, 10),
          title: data.title,
          description: data.description,
          deadline: data.deadline ? new Date(data.deadline).toISOString() : undefined,
          phase: data.phase,
        }
      });
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      setIsDialogOpen(false);
      form.reset();
      toast({ title: "Task Created", description: "The task has been successfully created." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create task.", variant: "destructive" });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case TaskStatus.pending:
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700">Pending</Badge>;
      case TaskStatus.submitted:
        return <Badge variant="outline" className="bg-blue-50 text-blue-700">Submitted</Badge>;
      case TaskStatus.reviewed:
        return <Badge variant="outline" className="bg-green-50 text-green-700">Reviewed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const visibleTasks = user?.role === 'student' && myTeam && studentHasSupervisor
    ? tasks?.filter((task) => task.teamId === myTeam.id) ?? []
    : tasks ?? [];

  const pendingTasks = visibleTasks.filter(t => t.status === TaskStatus.pending);
  const activeTasks = visibleTasks.filter(t => t.status !== TaskStatus.pending);

  return (
    <AppLayout title="Tasks">
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Task Management</h2>
            <p className="text-muted-foreground">Track project milestones and submissions.</p>
          </div>
          
          {user?.role === 'supervisor' && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2" disabled={!supervisorCanCreateTasks}>
                  <Plus className="h-4 w-4" /> Create Task
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-125">
                <DialogHeader>
                  <DialogTitle>Create New Task</DialogTitle>
                  <DialogDescription>
                    Assign a task to one of your supervised teams.
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="teamId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Team</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a team" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {supervisorTeams?.map(team => (
                                <SelectItem key={team.id} value={team.id.toString()}>{team.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Task Title</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Initial Proposal Draft" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      {/* <FormField
                        control={form.control}
                        name="phase"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Project Phase</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select phase" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value={CreateTaskBodyPhase.proposal}>Proposal</SelectItem>
                                <SelectItem value={CreateTaskBodyPhase.progress}>Progress</SelectItem>
                                <SelectItem value={CreateTaskBodyPhase.final}>Final</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      /> */}
                      <FormField
                        control={form.control}
                        name="deadline"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Deadline (Optional)</FormLabel>
                            <FormControl>
                              <Input type="datetime-local" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Task details and requirements..." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={createTask.isPending}>
                        {createTask.isPending ? "Creating..." : "Create Task"}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {user?.role === 'supervisor' && !supervisorCanCreateTasks ? (
          <Card className="border-dashed">
            <CardContent className="p-4 text-sm text-muted-foreground">
              You cannot create tasks until you are assigned to at least one team.
            </CardContent>
          </Card>
        ) : null}

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : user?.role === 'student' && myTeam && !studentHasSupervisor ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-12 text-center">
              <CheckSquare className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">Tasks unavailable</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Your team no longer has a supervisor, so tasks are hidden until a supervisor is assigned again.
              </p>
            </CardContent>
          </Card>
        ) : tasks?.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-12 text-center">
              <CheckSquare className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No tasks found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {user?.role === 'supervisor' ? "You haven't assigned any tasks yet." : "Your team has no tasks currently."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {pendingTasks.length > 0 && (
              <div>
                <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-500" /> Action Required
                </h3>
                <div className="grid gap-4">
                  {pendingTasks.map(task => (
                    <Card key={task.id} className="border-l-4 border-l-yellow-500">
                      <CardContent className="p-5 flex flex-col md:flex-row justify-between gap-4">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center justify-between">
                            <h4 className="font-bold text-lg">{task.title}</h4>
                            <Badge variant="outline" className="capitalize bg-secondary">{task.phase}</Badge>
                          </div>
                          {user?.role === 'supervisor' && (
                            <p className="text-sm font-medium text-muted-foreground">Team: {task.team.name}</p>
                          )}
                          <p className="text-sm text-muted-foreground line-clamp-2">{task.description}</p>
                          {task.deadline && (
                            <p className="text-xs font-medium flex items-center gap-1 text-destructive">
                              <Calendar className="h-3 w-3" /> Due: {format(new Date(task.deadline), 'MMM d, yyyy h:mm a')}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center justify-end min-w-30">
                          <Button asChild>
                            <Link href={`/tasks/${task.id}`}>
                              {user?.role === 'student' ? 'Submit Work' : 'View Details'} <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {activeTasks.length > 0 && (
              <div>
                <h3 className="text-lg font-medium mb-4">All Tasks</h3>
                <div className="grid gap-4">
                  {activeTasks.map(task => (
                    <Card key={task.id}>
                      <CardContent className="p-4 flex flex-col sm:flex-row justify-between gap-4 sm:items-center">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium">{task.title}</h4>
                            {getStatusBadge(task.status)}
                            {/* <Badge variant="outline" className="capitalize text-xs">{task.phase}</Badge> */}
                          </div>
                          {user?.role === 'supervisor' && (
                            <p className="text-xs text-muted-foreground">Team: {task.team.name}</p>
                          )}
                          {task.deadline && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Calendar className="h-3 w-3" /> Due: {format(new Date(task.deadline), 'MMM d, yyyy')}
                            </p>
                          )}
                        </div>
                        <Button asChild variant="secondary" size="sm">
                          <Link href={`/tasks/${task.id}`}>View</Link>
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}