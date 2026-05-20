import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { 
  useListInvitations, 
  useAcceptInvitation, 
  useRejectInvitation,
  getListInvitationsQueryKey,
  InvitationStatus
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Mail, Check, X, Users, Clock } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";

export default function Invitations() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: invitations, isLoading, error: invitationsError, isError: isInvitationsError } = useListInvitations({
    query: {
      queryKey: getListInvitationsQueryKey(),
      enabled: user?.role === 'student'
    }
  });

  const invitationsList = Array.isArray(invitations) ? invitations : [];

  const acceptInvitation = useAcceptInvitation();
  const rejectInvitation = useRejectInvitation();

  if (user?.role !== 'student') {
    return (
      <AppLayout title="Invitations">
        <div className="flex flex-col items-center justify-center p-12 text-center bg-card rounded-lg border border-dashed mt-8">
          <h2 className="text-2xl font-bold tracking-tight">Access Denied</h2>
          <p className="text-muted-foreground max-w-md mt-2 mb-6">
            Only students can access team invitations.
          </p>
        </div>
      </AppLayout>
    );
  }

  const isJoinRequestForLeader = (invitation: (typeof invitationsList)[number]) => {
    return invitation.invitedUserId === user?.id && invitation.team.leaderId === user?.id;
  };

  const handleAccept = async (invitation: (typeof invitationsList)[number]) => {
    try {
      await acceptInvitation.mutateAsync({ id: invitation.id });
      queryClient.invalidateQueries({ queryKey: getListInvitationsQueryKey() });

      const joinRequest = isJoinRequestForLeader(invitation);
      toast({
        title: joinRequest ? "Join Request Accepted" : "Invitation Accepted",
        description: joinRequest
          ? "The student was added to your team."
          : "You have successfully joined the team.",
      });
      if (!joinRequest) {
        setLocation("/my-team");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to accept invitation.",
        variant: "destructive",
      });
    }
  };

  const handleReject = async (invitation: (typeof invitationsList)[number]) => {
    try {
      await rejectInvitation.mutateAsync({ id: invitation.id });
      queryClient.invalidateQueries({ queryKey: getListInvitationsQueryKey() });

      const joinRequest = isJoinRequestForLeader(invitation);
      toast({
        title: joinRequest ? "Join Request Rejected" : "Invitation Rejected",
        description: joinRequest
          ? "The join request was rejected."
          : "You have rejected the team invitation.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to reject invitation.",
        variant: "destructive",
      });
    }
  };

  const isPendingStatus = (status: unknown) => String(status).toLowerCase() === String(InvitationStatus.pending).toLowerCase();
  const isAcceptedStatus = (status: unknown) => String(status).toLowerCase() === String(InvitationStatus.accepted).toLowerCase();

  const pendingInvitations = invitationsList.filter(inv => isPendingStatus(inv.status));
  const pastInvitations = invitationsList.filter(inv => !isPendingStatus(inv.status));

  const invitationQueryError = invitationsError as any;

  return (
    <AppLayout title="Team Invitations">
      <div className="space-y-8 max-w-4xl mx-auto">
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-2">Pending Invitations</h2>
          <p className="text-muted-foreground mb-6">
            Review and respond to requests to join graduation project teams.
          </p>

          {isLoading ? (
            <div className="space-y-4">
              {[...Array(2)].map((_, i) => (
                <Card key={i}>
                  <CardHeader className="pb-3">
                    <Skeleton className="h-6 w-1/3 mb-2" />
                    <Skeleton className="h-4 w-1/4" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-10 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : isInvitationsError ? (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-6">
                <h3 className="text-base font-semibold text-destructive">Unable to load invitations</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {invitationQueryError?.message || "An unexpected error occurred while loading invitations."}
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => queryClient.invalidateQueries({ queryKey: getListInvitationsQueryKey() })}
                >
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : pendingInvitations.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <Mail className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No pending invitations</h3>
                <p className="text-sm text-muted-foreground max-w-sm mt-1">
                  You don't have any pending requests to join a team right now.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {pendingInvitations.map((invitation) => (
                <Card key={invitation.id} className="overflow-hidden border-primary/20 shadow-sm">
                  <div className="flex flex-col md:flex-row">
                    <div className="flex-1 p-6">
                      {(() => {
                        const joinRequest = isJoinRequestForLeader(invitation);
                        return (
                          <>
                            <div className="flex items-center justify-between mb-2">
                              <Badge variant="outline" className="bg-blue-50 text-blue-700">
                                {joinRequest ? "Join Request" : "Team Invitation"}
                              </Badge>
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {format(new Date(invitation.createdAt), "MMM d, yyyy")}
                              </span>
                            </div>
                            <h3 className="text-xl font-bold mb-1">{invitation.team.name}</h3>
                            {invitation.team.projectTitle && (
                              <p className="text-sm font-medium text-foreground mb-3">{invitation.team.projectTitle}</p>
                            )}

                            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-4">
                              <div className="flex items-center gap-1">
                                <Users className="h-4 w-4" />
                                {invitation.team.memberCount} existing members
                              </div>
                              <div>
                                {joinRequest ? "Requested by" : "Invited by"}{" "}
                                <span className="font-medium text-foreground">{invitation.invitedBy.name}</span>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <div className="bg-muted/30 p-6 flex flex-row md:flex-col items-center justify-center gap-3 border-t md:border-t-0 md:border-l">
                      <Button 
                        onClick={() => handleAccept(invitation)} 
                        disabled={acceptInvitation.isPending || rejectInvitation.isPending}
                        className="w-full md:w-32 bg-primary hover:bg-primary/90"
                      >
                        <Check className="h-4 w-4 mr-2" /> Accept
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => handleReject(invitation)} 
                        disabled={acceptInvitation.isPending || rejectInvitation.isPending}
                        className="w-full md:w-32"
                      >
                        <X className="h-4 w-4 mr-2" /> Decline
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {pastInvitations.length > 0 && (
          <div>
            <h2 className="text-xl font-bold tracking-tight mb-4">Past Invitations</h2>
            <div className="space-y-4">
              {pastInvitations.map((invitation) => (
                <Card key={invitation.id}>
                  <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <h4 className="font-medium">{invitation.team.name}</h4>
                      <p className="text-sm text-muted-foreground">
                        Invited by {invitation.invitedBy.name} on {format(new Date(invitation.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>
                    <Badge 
                      variant={isAcceptedStatus(invitation.status) ? "default" : "destructive"}
                      className="capitalize"
                    >
                      {invitation.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}