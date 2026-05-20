import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { 
  useListMeetings, 
  getListMeetingsQueryKey,
  useRequestMeeting,
  useApproveMeeting,
  useRejectMeeting,
  useGetMyTeam,
  getGetMyTeamQueryKey,
  MeetingStatus
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Calendar as CalendarIcon, Clock, Check, X, Plus } from "lucide-react";
import { format } from "date-fns";

function parseOfficeHours(officeHours?: string | null) {
  return (officeHours || "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function formatOfficeHour(slot: string) {
  return format(new Date(slot), "EEE, MMM d, yyyy h:mm a");
}

const requestMeetingSchema = z.object({
  proposedDate: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

export default function Meetings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isOfficeHoursOpen, setIsOfficeHoursOpen] = useState(false);

  const { data: myTeam } = useGetMyTeam({
    query: {
      enabled: user?.role === 'student',
      queryKey: getGetMyTeamQueryKey(),
    }
  });

  const [, setLocation] = useLocation();

  // Route guard: Only team leaders can access this page
  useEffect(() => {
    if (user?.role === 'student' && myTeam && user?.id !== myTeam.leaderId) {
      setLocation('/dashboard');
    }
  }, [user, myTeam, setLocation]);

  const { data: meetings, isLoading } = useListMeetings({
    query: {
      queryKey: getListMeetingsQueryKey(),
    }
  });

  const requestMeeting = useRequestMeeting();
  const approveMeeting = useApproveMeeting();
  const rejectMeeting = useRejectMeeting();
  const isTeamLeader = Boolean(user?.role === "student" && myTeam && myTeam.leaderId === user.id);
  const officeHourSlots = parseOfficeHours(myTeam?.supervisor?.officeHours);

  const form = useForm<z.infer<typeof requestMeetingSchema>>({
    resolver: zodResolver(requestMeetingSchema),
    defaultValues: {
      proposedDate: "",
      notes: "",
    },
  });

  const onSubmit = async (data: z.infer<typeof requestMeetingSchema>) => {
    if (!myTeam || !myTeam.supervisorId || officeHourSlots.length === 0) return;
    try {
      await requestMeeting.mutateAsync({
        data: {
          supervisorId: myTeam.supervisorId,
          proposedDate: data.proposedDate,
          notes: data.notes,
        }
      });
      queryClient.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
      setIsDialogOpen(false);
      form.reset();
      toast({ title: "Meeting Requested", description: "Your meeting request has been sent to the supervisor." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to request meeting.", variant: "destructive" });
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await approveMeeting.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
      toast({ title: "Meeting Approved", description: "The meeting has been scheduled." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to approve meeting.", variant: "destructive" });
    }
  };

  const handleReject = async (id: number) => {
    try {
      await rejectMeeting.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
      toast({ title: "Meeting Rejected", description: "The meeting request was declined." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to reject meeting.", variant: "destructive" });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case MeetingStatus.pending: return <Badge variant="outline" className="bg-yellow-50 text-yellow-700">Pending</Badge>;
      case MeetingStatus.approved: return <Badge variant="outline" className="bg-green-50 text-green-700">Approved</Badge>;
      case MeetingStatus.rejected: return <Badge variant="outline" className="bg-red-50 text-red-700">Rejected</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const pendingMeetings = meetings?.filter(m => m.status === MeetingStatus.pending) || [];
  const otherMeetings = meetings?.filter(m => m.status !== MeetingStatus.pending) || [];

  return (
    <AppLayout title="Meetings">
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Meetings</h2>
            <p className="text-muted-foreground">Manage meeting requests with your {user?.role === 'supervisor' ? 'teams' : 'supervisor'}.</p>
          </div>
          
          {isTeamLeader && myTeam && myTeam.supervisorId && (
            <div className="flex flex-wrap gap-2">
              <Dialog open={isOfficeHoursOpen} onOpenChange={setIsOfficeHoursOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" className="gap-2" disabled={officeHourSlots.length === 0}>
                    <Clock className="h-4 w-4" /> Office Hours
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Supervisor Office Hours</DialogTitle>
                    <DialogDescription>
                      {myTeam.supervisor?.name} has shared these available meeting slots.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    {officeHourSlots.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No office hours have been configured yet.</p>
                    ) : (
                      officeHourSlots.map((slot) => (
                        <div key={slot} className="rounded-lg border px-4 py-3 text-sm font-medium">
                          {formatOfficeHour(slot)}
                        </div>
                      ))
                    )}
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2" disabled={officeHourSlots.length === 0}><Plus className="h-4 w-4" /> Request Meeting</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Request a Meeting</DialogTitle>
                    <DialogDescription>
                      Choose one of your supervisor's office hour slots, {myTeam.supervisor?.name}.
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <FormField
                        control={form.control}
                        name="proposedDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Available Office Hours</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder={officeHourSlots.length > 0 ? "Select an office hour" : "No office hours available"} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {officeHourSlots.map((slot) => (
                                  <SelectItem key={slot} value={slot}>
                                    {formatOfficeHour(slot)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="notes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Agenda / Notes (Optional)</FormLabel>
                            <FormControl>
                              <Textarea placeholder="What would you like to discuss?" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={requestMeeting.isPending || officeHourSlots.length === 0}>
                          {requestMeeting.isPending ? "Requesting..." : "Send Request"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        {user?.role === 'student' && myTeam && !myTeam.supervisorId && (
          <Card className="border-dashed bg-muted/50">
            <CardContent className="p-6 text-center text-muted-foreground">
              You must have an assigned supervisor before you can request meetings.
            </CardContent>
          </Card>
        )}

        {user?.role === 'student' && myTeam && myTeam.supervisorId && !isTeamLeader && (
          <Card className="border-dashed bg-muted/50">
            <CardContent className="p-6 text-center text-muted-foreground">
              Only the team leader can request meetings with the supervisor.
            </CardContent>
          </Card>
        )}

        {user?.role === 'student' && myTeam && myTeam.supervisorId && officeHourSlots.length === 0 && (
          <Card className="border-dashed bg-muted/50">
            <CardContent className="p-6 text-center text-muted-foreground">
              Your supervisor has not configured office hours yet.
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : meetings?.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-12 text-center">
              <CalendarIcon className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No meetings</h3>
              <p className="text-sm text-muted-foreground mt-1">
                You don't have any meeting requests yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {pendingMeetings.length > 0 && (
              <div>
                <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-500" /> Pending Requests
                </h3>
                <div className="grid gap-4">
                  {pendingMeetings.map(meeting => (
                    <Card key={meeting.id}>
                      <CardContent className="p-5 flex flex-col sm:flex-row justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-lg">
                              {user?.role === 'supervisor' ? meeting.team.name : meeting.supervisor.name}
                            </h4>
                            {getStatusBadge(meeting.status)}
                          </div>
                          <p className="text-sm font-medium flex items-center gap-1">
                            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                            {format(new Date(meeting.proposedDate), 'EEEE, MMMM d, yyyy ')} at {format(new Date(meeting.proposedDate), 'h:mm a')}
                          </p>
                          {meeting.notes && (
                            <p className="text-sm text-muted-foreground mt-2 border-l-2 pl-2">
                              {meeting.notes}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Requested by {meeting.requestedBy.name}
                          </p>
                        </div>
                        {user?.role === 'supervisor' && (
                          <div className="flex flex-col gap-2 min-w-30">
                            <Button onClick={() => handleApprove(meeting.id)} disabled={approveMeeting.isPending} size="sm">
                              <Check className="h-4 w-4 mr-2" /> Approve
                            </Button>
                            <Button variant="outline" onClick={() => handleReject(meeting.id)} disabled={rejectMeeting.isPending} size="sm">
                              <X className="h-4 w-4 mr-2" /> Decline
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {otherMeetings.length > 0 && (
              <div>
                <h3 className="text-lg font-medium mb-4">Past / Scheduled Meetings</h3>
                <div className="grid gap-4">
                  {otherMeetings.map(meeting => (
                    <Card key={meeting.id}>
                      <CardContent className="p-4 flex flex-col sm:flex-row justify-between gap-4 sm:items-center">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium">
                              {user?.role === 'supervisor' ? meeting.team.name : meeting.supervisor.name}
                            </h4>
                            {getStatusBadge(meeting.status)}
                          </div>
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <CalendarIcon className="h-3 w-3" />
                            {format(new Date(meeting.proposedDate), 'MMM d, yyyy h:mm a')}
                          </p>
                        </div>
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