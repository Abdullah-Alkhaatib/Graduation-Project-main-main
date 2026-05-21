import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { useGetTeam, useGetTeamMembers, getGetTeamQueryKey, getGetTeamMembersQueryKey, getGetSupervisorDashboardQueryKey, getListUsersQueryKey, useSendInvitation, useListUsers, useCoordinatorAssignSupervisor, TeamStatus, ListUsersRole } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useParams } from "wouter";
import { Users, Briefcase, Mail, Activity, ArrowLeft, UserMinus } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";

export default function TeamDetail() {
  const { id } = useParams();
  const teamId = parseInt(id || "0", 10);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: team, isLoading: isLoadingTeam } = useGetTeam(teamId, {
    query: {
      enabled: !!teamId,
      queryKey: getGetTeamQueryKey(teamId),
    }
  });

  const { data: members, isLoading: isLoadingMembers } = useGetTeamMembers(teamId, {
    query: {
      enabled: !!teamId,
      queryKey: getGetTeamMembersQueryKey(teamId),
    }
  });

  const sendInvitation = useSendInvitation();
  const [inviteStudentId, setInviteStudentId] = useState("");
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isRequestingJoin, setIsRequestingJoin] = useState(false);
  const [hasSentJoinRequest, setHasSentJoinRequest] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState<number | null>(null);
  const [isStoppingSupervision, setIsStoppingSupervision] = useState(false);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState("");
  const [isAssigningSupervisor, setIsAssigningSupervisor] = useState(false);
  const [isRemoveSupervisorDialogOpen, setIsRemoveSupervisorDialogOpen] = useState(false);

  const assignSupervisor = useCoordinatorAssignSupervisor();
  const { data: supervisors, isLoading: isLoadingSupervisors } = useListUsers(
    { role: ListUsersRole.supervisor },
    {
      query: {
        queryKey: getListUsersQueryKey({ role: ListUsersRole.supervisor }),
        enabled: user?.role === "coordinator",
      },
    }
  );

  const isLeader = members?.some(m => m.userId === user?.id && m.role === 'leader');
  const isCurrentSupervisor = user?.role === "supervisor" && team?.supervisor?.id === user?.id;
  const canManageSupervisor = user?.role === "coordinator";
  const hasSupervisor = Boolean(team?.supervisor?.id);

  const handleInvite = async () => {
    try {
      if (!inviteStudentId.trim()) {
        toast({
          title: "Error",
          description: "Please enter a valid student ID.",
          variant: "destructive",
        });
        return;
      }

      await sendInvitation.mutateAsync({
        data: {
          teamId,
          studentId: inviteStudentId,
        }
      });
      setIsInviteDialogOpen(false);
      setInviteStudentId("");
      toast({
        title: "Invitation Sent",
        description: "Team members were notified to approve or reject this invitation.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send invitation.",
        variant: "destructive",
      });
    }
  };

  const handleJoinRequest = async () => {
    try {
      setIsRequestingJoin(true);
      const response = await fetch(`/api/teams/${teamId}/join-request`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data && typeof data.error === "string" ? data.error : "Failed to send join request.";
        throw new Error(message);
      }

      setHasSentJoinRequest(true);
      toast({
        title: "Request sent",
        description: "Your join request was sent to the team leader.",
      });
      queryClient.invalidateQueries({ queryKey: getGetTeamMembersQueryKey(teamId) });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send join request.",
        variant: "destructive",
      });
    } finally {
      setIsRequestingJoin(false);
    }
  };

  const handleRemoveMember = async (memberUserId: number) => {
    try {
      const response = await fetch(`/api/teams/${teamId}/members/${memberUserId}/remove`, {
        method: "POST",
        credentials: "include",
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Failed to remove member.");
      }

      await queryClient.invalidateQueries({ queryKey: getGetTeamMembersQueryKey(teamId) });
      await queryClient.invalidateQueries({ queryKey: getGetTeamQueryKey(teamId) });
      toast({ title: "Member removed", description: "The member has been removed from the team." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to remove member.", variant: "destructive" });
    }
  };

  const handleTransferLeadership = async (memberUserId: number) => {
    try {
      const response = await fetch(`/api/teams/${teamId}/transfer-leader`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ memberId: memberUserId }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Failed to transfer leadership.");
      }

      await queryClient.invalidateQueries({ queryKey: getGetTeamMembersQueryKey(teamId) });
      await queryClient.invalidateQueries({ queryKey: getGetTeamQueryKey(teamId) });
      toast({ title: "Leadership transferred", description: "The selected member is now the team leader." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to transfer leadership.", variant: "destructive" });
    } finally {
      setTransferTargetId(null);
    }
  };

  const handleStopSupervising = async () => {
    try {
      setIsStoppingSupervision(true);
      const response = await fetch(`/api/supervisor/unassign-supervisor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ teamId }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Failed to stop supervising this team.");
      }

      await queryClient.invalidateQueries({ queryKey: getGetTeamQueryKey(teamId) });
      await queryClient.invalidateQueries({ queryKey: getGetTeamMembersQueryKey(teamId) });
      await queryClient.invalidateQueries({ queryKey: getGetSupervisorDashboardQueryKey() });
      toast({ title: "Supervisor removed", description: "You are no longer supervising this team." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to stop supervising this team.", variant: "destructive" });
    } finally {
      setIsStoppingSupervision(false);
    }
  };

  const handleAssignSupervisor = async () => {
    if (!selectedSupervisorId) {
      toast({ title: "Error", description: "Please select a supervisor.", variant: "destructive" });
      return;
    }

    try {
      setIsAssigningSupervisor(true);
      await assignSupervisor.mutateAsync({ data: { teamId, supervisorId: parseInt(selectedSupervisorId, 10) } });
      setIsAssignDialogOpen(false);
      setSelectedSupervisorId("");
      await queryClient.invalidateQueries({ queryKey: getGetTeamQueryKey(teamId) });
      await queryClient.invalidateQueries({ queryKey: getGetTeamMembersQueryKey(teamId) });
      await queryClient.invalidateQueries({ queryKey: getGetSupervisorDashboardQueryKey() });
      toast({ title: "Supervisor assigned", description: "A supervisor has been assigned to this team." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to assign supervisor.", variant: "destructive" });
    } finally {
      setIsAssigningSupervisor(false);
    }
  };

  const handleCoordinatorRemoveSupervisor = async () => {
    try {
      const response = await fetch(`/api/coordinator/unassign-supervisor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ teamId }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Failed to remove supervisor.");
      }

      await queryClient.invalidateQueries({ queryKey: getGetTeamQueryKey(teamId) });
      await queryClient.invalidateQueries({ queryKey: getGetTeamMembersQueryKey(teamId) });
      await queryClient.invalidateQueries({ queryKey: getGetSupervisorDashboardQueryKey() });
      setIsRemoveSupervisorDialogOpen(false);
      toast({ title: "Supervisor removed", description: "The supervisor has been removed from the team." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to remove supervisor.", variant: "destructive" });
    }
  };

  if (isLoadingTeam || isLoadingMembers) {
    return (
      <AppLayout title="Team Details">
        <div className="space-y-6">
          <Skeleton className="h-8 w-32" />
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-1/3 mb-2" />
              <Skeleton className="h-4 w-1/4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (!team) {
    return (
      <AppLayout title="Team Details">
        <div className="text-center p-12">
          <h2 className="text-xl font-bold">Team not found</h2>
          <p className="text-muted-foreground mt-2">The team you're looking for doesn't exist or you don't have access.</p>
          <Button asChild className="mt-4">
            <Link href="/teams">Back to Teams</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  const isMember = members?.some(m => m.userId === user?.id) ?? false;
  const canRequestJoin = Boolean(user && user.role === "student" && !isMember && !isLeader && team.status !== TeamStatus.completed);

  return (
    <AppLayout title={team.name}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button asChild variant="outline" size="icon">
            <Link href="/teams">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h2 className="text-2xl font-bold tracking-tight">Team Profile</h2>
          {canRequestJoin && (
            <Button
              onClick={handleJoinRequest}
              disabled={isRequestingJoin || hasSentJoinRequest}
              className="ml-auto"
            >
              {hasSentJoinRequest ? "Request Sent" : isRequestingJoin ? "Sending..." : "Join Team"}
            </Button>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
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
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border p-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="bg-primary/10 p-2 rounded-md">
                          <Briefcase className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Supervisor</p>
                          <p className="text-sm font-medium">{team.supervisor?.name || "Unassigned"}</p>
                        </div>
                      </div>
                      {canManageSupervisor && (
                        <div className="flex flex-wrap gap-2">
                          {hasSupervisor ? (
                            <AlertDialog open={isRemoveSupervisorDialogOpen} onOpenChange={setIsRemoveSupervisorDialogOpen}>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="destructive" className="gap-2">
                                  Remove Supervisor
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove supervisor?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will unassign the current supervisor from <strong>{team.name}</strong>.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={handleCoordinatorRemoveSupervisor}
                                  >
                                    Yes, remove supervisor
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : (
                            <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline" className="gap-2">
                                  Assign Supervisor
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Assign Supervisor</DialogTitle>
                                  <DialogDescription>
                                    Choose a supervisor to assign to this team.
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                  <div className="space-y-2">
                                    <Label htmlFor="supervisorId">Supervisor</Label>
                                    <Select value={selectedSupervisorId} onValueChange={setSelectedSupervisorId}>
                                      <SelectTrigger id="supervisorId">
                                        <SelectValue placeholder={isLoadingSupervisors ? "Loading supervisors..." : "Select a supervisor"} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {supervisors?.length ? (
                                          supervisors.map((sup) => (
                                            <SelectItem key={sup.id} value={sup.id.toString()}>
                                              {sup.name} • {sup.email}
                                            </SelectItem>
                                          ))
                                        ) : (
                                          <SelectItem value="" disabled>
                                            No supervisors available
                                          </SelectItem>
                                        )}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                <DialogFooter>
                                  <Button variant="outline" onClick={() => setIsAssignDialogOpen(false)}>Cancel</Button>
                                  <Button
                                    onClick={handleAssignSupervisor}
                                    disabled={isAssigningSupervisor || !selectedSupervisorId || isLoadingSupervisors}
                                  >
                                    {isAssigningSupervisor ? "Assigning..." : "Assign Supervisor"}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {isCurrentSupervisor && (
                    <div className="md:col-span-2 flex justify-end">
                      <Button
                        variant="destructive"
                        className="gap-2"
                        onClick={handleStopSupervising}
                        disabled={isStoppingSupervision}
                      >
                        {isStoppingSupervision ? "Stopping..." : "Stop Supervising"}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle>Team Members</CardTitle>
                  <CardDescription>People working on this project</CardDescription>
                </div>
                {isLeader && team.status !== TeamStatus.completed && (
                  <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="gap-2">
                        <Mail className="h-4 w-4" /> Invite Member
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Invite Student</DialogTitle>
                        <DialogDescription>
                          Enter the Student ID of the student you want to invite.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="studentId">Student ID</Label>
                          <Input 
                            id="studentId" 
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="e.g. 123456"
                            maxLength={6}
                            value={inviteStudentId}
                            onChange={(e) => {
                              const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 6);
                              setInviteStudentId(digitsOnly);
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            Use the 6-digit student ID (numbers only).
                          </p>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsInviteDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleInvite} disabled={!inviteStudentId || sendInvitation.isPending}>
                          {sendInvitation.isPending ? "Sending..." : "Send Invitation"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {members?.map((member) => (
                    <div key={member.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                          {member.user.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{member.user.name}</p>
                          <p className="text-xs text-muted-foreground">{member.user.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={member.role === 'leader' ? "default" : "secondary"} className="capitalize">
                          {member.role}
                        </Badge>
                        {isLeader && member.userId !== user?.id && (
                          <div className="flex items-center gap-2">
                            <AlertDialog open={transferTargetId === member.userId} onOpenChange={(open) => setTransferTargetId(open ? member.userId : null)}>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="outline" className="gap-2 cursor-pointer transition-colors hover:bg-muted/80">
                                  Make Leader
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Transfer leadership?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    You are about to make <strong>{member.user.name}</strong> the new leader of <strong>{team.name}</strong>.
                                    You will remain a team member after the transfer.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
                                    onClick={() => handleTransferLeadership(member.userId)}
                                  >
                                    Yes, transfer leadership
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="gap-2 cursor-pointer transition-colors hover:bg-destructive/90"
                              onClick={() => handleRemoveMember(member.userId)}
                            >
                              <UserMinus className="h-4 w-4" /> Remove
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {(!members || members.length === 0) && (
                    <p className="text-sm text-muted-foreground text-center py-4">No members found.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Team Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Member Count</span>
                  <span className="font-medium">{team.memberCount}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">{new Date(team.createdAt).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}