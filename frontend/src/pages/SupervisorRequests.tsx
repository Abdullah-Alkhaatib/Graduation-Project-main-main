import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { 
  useListSupervisorRequests, 
  useSendSupervisorRequest, 
  useAcceptSupervisorRequest, 
  useRejectSupervisorRequest,
  getListSupervisorRequestsQueryKey,
  SupervisorRequestStatus,
  useGetMyTeam,
  getGetMyTeamQueryKey,
  useListUsers,
  getListUsersQueryKey,
  ListUsersRole
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useMemo } from "react";
import { Check, X, Clock, UserPlus } from "lucide-react";
import { format } from "date-fns";

export default function SupervisorRequests() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: requests, isLoading: requestsLoading } = useListSupervisorRequests({
    query: {
      queryKey: getListSupervisorRequestsQueryKey(),
    }
  });

  const { data: myTeam } = useGetMyTeam({
    query: {
      queryKey: getGetMyTeamQueryKey(),
      enabled: user?.role === 'student',
      retry: false
    }
  });

  const [, setLocation] = useLocation();

  // Route guard: Only team leaders and supervisors can access this page
  useEffect(() => {
    if (user?.role === 'student' && myTeam && user?.id !== myTeam.leaderId) {
      setLocation('/dashboard');
    }
  }, [user, myTeam, setLocation]);

  const { data: supervisors } = useListUsers(
    { role: ListUsersRole.supervisor },
    {
      query: {
        queryKey: getListUsersQueryKey({ role: ListUsersRole.supervisor }),
        enabled: user?.role === 'student',
      }
    }
  );

  const sendRequest = useSendSupervisorRequest();
  const acceptRequest = useAcceptSupervisorRequest();
  const rejectRequest = useRejectSupervisorRequest();

  const canRequestSupervisor = user?.role === "student" && myTeam && myTeam.leaderId === user.id && !myTeam.supervisorId;

  const availableSupervisors = useMemo(() => supervisors ?? [], [supervisors]);

  const handleRequestSupervisor = async (supervisorId: number) => {
    try {
      await sendRequest.mutateAsync({ 
        data: {
          supervisorId,
        }
      });
      queryClient.invalidateQueries({ queryKey: getListSupervisorRequestsQueryKey() });
      toast({
        title: "Request Sent",
        description: "Your supervision request has been sent.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send request.",
        variant: "destructive",
      });
    }
  };

  const handleAccept = async (id: number) => {
    try {
      await acceptRequest.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListSupervisorRequestsQueryKey() });
      toast({ title: "Request Accepted", description: "You are now supervising this team." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleReject = async (id: number) => {
    try {
      await rejectRequest.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListSupervisorRequestsQueryKey() });
      toast({ title: "Request Rejected", description: "You have declined the request." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  if (user?.role === 'coordinator') {
    return (
      <AppLayout title="Supervisor Requests">
        <div className="flex flex-col items-center justify-center p-12 text-center bg-card rounded-lg border border-dashed mt-8">
          <h2 className="text-2xl font-bold tracking-tight">Not Applicable</h2>
          <p className="text-muted-foreground mt-2">Coordinators manage assignments from the Coordinator panel.</p>
        </div>
      </AppLayout>
    );
  }

  const pendingRequests = requests?.filter(r => r.status === SupervisorRequestStatus.pending) || [];
  const pastRequests = requests?.filter(r => r.status !== SupervisorRequestStatus.pending) || [];

  return (
    <AppLayout title="Supervisor Requests">
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="hero-panel rounded-3xl p-6 md:p-8">
          <div className="relative z-10">
            <div className="section-label border-white/15 bg-white/10 text-white/90">Requests</div>
            <h2 className="mt-4 text-3xl font-black tracking-tight">Supervisor Requests</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/85">
              Manage supervision requests with a simpler, more readable flow.
            </p>
          </div>
        </div>

        {canRequestSupervisor && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <UserPlus className="h-5 w-5" /> Available Supervisors
              </CardTitle>
              <CardDescription>
                Pick a supervisor for your team. This option is available only to the team leader while the team has no supervisor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {availableSupervisors.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                  No supervisors are available right now.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {availableSupervisors.map((supervisor) => (
                    <div key={supervisor.id} className="flex items-center justify-between rounded-2xl border bg-card p-4 shadow-sm">
                      <div>
                        <p className="font-semibold">{supervisor.name}</p>
                        <p className="text-sm text-muted-foreground">{supervisor.email}</p>
                      </div>
                      <Button
                        onClick={() => handleRequestSupervisor(supervisor.id)}
                        disabled={sendRequest.isPending}
                        className="gap-2"
                      >
                        <UserPlus className="h-4 w-4" />
                        Request
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!canRequestSupervisor && user?.role === "student" && myTeam && myTeam.leaderId !== user.id && (
          <Card className="border-dashed glass-card">
            <CardContent className="p-6 text-center text-muted-foreground">
              Only the team leader can request a supervisor.
            </CardContent>
          </Card>
        )}

        {user?.role === "student" && myTeam && myTeam.supervisorId && (
          <Card className="border-dashed glass-card">
            <CardContent className="p-6 text-center text-muted-foreground">
              Your team already has a supervisor assigned.
            </CardContent>
          </Card>
        )}

        {requestsLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Pending</h3>
              {pendingRequests.length === 0 ? (
                <Card className="border-dashed glass-card">
                  <CardContent className="p-8 text-center text-muted-foreground">
                    No pending requests.
                  </CardContent>
                </Card>
              ) : (
                pendingRequests.map(request => (
                  <Card key={request.id} className="glass-card">
                    <CardContent className="p-6">
                      <div className="flex flex-col md:flex-row justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className="bg-yellow-50 text-yellow-700 hover:bg-yellow-50">Pending</Badge>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {request.createdAt ? format(new Date(request.createdAt), "MMM d, yyyy") : "Unknown date"}
                            </span>
                          </div>
                          {user?.role === 'supervisor' ? (
                            <>
                              <h4 className="font-bold text-lg">{request.team?.name ?? "Unknown team"}</h4>
                              <p className="text-sm font-medium">{request.team?.projectTitle ?? ""}</p>
                            </>
                          ) : (
                            <h4 className="font-bold text-lg">To: {request.supervisor?.name ?? "Unknown supervisor"}</h4>
                          )}
                          {request.message && (
                            <div className="mt-3 p-3 bg-muted rounded-md text-sm italic">
                              "{request.message}"
                            </div>
                          )}
                        </div>
                        {user?.role === 'supervisor' && (
                          <div className="flex flex-col gap-2 min-w-30">
                            <Button onClick={() => handleAccept(request.id)} disabled={acceptRequest.isPending} size="sm">
                              <Check className="h-4 w-4 mr-2" /> Accept
                            </Button>
                            <Button variant="outline" onClick={() => handleReject(request.id)} disabled={rejectRequest.isPending} size="sm">
                              <X className="h-4 w-4 mr-2" /> Decline
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>

            {pastRequests.length > 0 && (
              <div className="space-y-4 mt-8">
                <h3 className="text-lg font-medium">History</h3>
                {pastRequests.map(request => (
                  <Card key={request.id}>
                    <CardContent className="p-4 flex justify-between items-center">
                      <div>
                        <h4 className="font-medium">
                          {user?.role === 'supervisor' ? (request.team?.name ?? "Unknown team") : `To: ${request.supervisor?.name ?? "Unknown supervisor"}`}
                        </h4>
                        <span className="text-xs text-muted-foreground">{request.createdAt ? format(new Date(request.createdAt), "MMM d, yyyy") : "Unknown date"}</span>
                      </div>
                      <Badge variant={request.status === SupervisorRequestStatus.accepted ? "default" : "destructive"} className="capitalize">
                        {request.status}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}