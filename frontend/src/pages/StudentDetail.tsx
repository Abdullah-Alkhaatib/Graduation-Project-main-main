import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { useGetProfile, getGetProfileQueryKey, useGetTeamMembers, getGetTeamMembersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { ArrowLeft, Users, User, Briefcase, Book, ClipboardList } from "lucide-react";

type StudentTeam = {
  id: number;
  name: string;
  status: string;
  projectTitle?: string | null;
  supervisor?: { name: string } | null;
  leader?: { name: string } | null;
};

export default function StudentDetail() {
  const { id } = useParams<{ id: string }>();
  const studentId = parseInt(id || "0", 10);
  const { user } = useAuth();

  const { data: profile, isLoading: profileLoading } = useGetProfile(studentId, {
    query: {
      enabled: !!studentId,
      queryKey: getGetProfileQueryKey(studentId),
    },
  });

  const { data: team, isLoading: teamLoading, error: teamError } = useQuery<StudentTeam | null>({
    queryKey: ["student-team", studentId],
    queryFn: async () => {
      const response = await fetch(`/api/profiles/${studentId}/team`, {
        credentials: "include",
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to load team details");
      }
      return response.json();
    },
    enabled: !!studentId,
  });

  const teamId = team?.id ? Number(team.id) : null;
  const { data: teamMembers, isLoading: teamMembersLoading } = useGetTeamMembers(
    teamId ?? 0,
    {
      query: {
        enabled: Boolean(teamId),
        queryKey: getGetTeamMembersQueryKey(teamId ?? 0),
      },
    }
  );

  const isLoading = profileLoading || teamLoading || teamMembersLoading;

  if (!user) {
    return null;
  }

  return (
    <AppLayout title={profile ? profile.user.name : "Student details"}>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-input bg-background px-3 py-1 text-sm text-muted-foreground">
              <ArrowLeft className="h-4 w-4" />
              <Link href="/students">Back to Students</Link>
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">{profile?.user.name ?? "Student details"}</h2>
              <p className="text-sm text-muted-foreground">View student profile, team assignment, and project status.</p>
            </div>
          </div>
          {profile?.user.email ? (
            <Badge variant="outline" className="rounded-full px-3 py-2 text-sm">
              {profile.user.email}
            </Badge>
          ) : null}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-48" />
            <Card>
              <CardContent>
                <Skeleton className="h-6 w-40 mb-4" />
                <Skeleton className="h-40 w-full" />
              </CardContent>
            </Card>
          </div>
        ) : !profile ? (
          <div className="text-center p-12">
            <h2 className="text-xl font-bold">Student not found</h2>
            <p className="text-muted-foreground mt-2">The requested student profile could not be loaded.</p>
            <Button asChild className="mt-4">
              <Link href="/students">Return to Students</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">Student Profile</CardTitle>
                  <CardDescription>Personal and academic details.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Name</p>
                      <p className="text-base font-semibold">{profile.user.name}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Student ID</p>
                      <p className="text-base font-semibold">{profile.studentId ?? "Not available"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Email</p>
                      <p className="text-base font-semibold">{profile.user.email}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">GPA</p>
                      <p className="text-base font-semibold">{profile.gpa ?? "Not set"}</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Skills</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {profile.skills ? profile.skills.split(",").map((skill) => (
                          <Badge key={skill.trim()} variant="secondary" className="text-sm">
                            {skill.trim()}
                          </Badge>
                        )) : <p className="text-sm text-muted-foreground">No skills listed</p>}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Interests</p>
                      <p className="text-base">{profile.interests || "No interests provided."}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">About</p>
                      <p className="text-base">{profile.description || "No description available."}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">Team & Project</CardTitle>
                  <CardDescription>Assigned team, supervisor, and status.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {teamError ? (
                    <p className="text-sm text-destructive">{(teamError as Error).message}</p>
                  ) : !team ? (
                    <p className="text-sm text-muted-foreground">No team assignment found for this student.</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Team Name</p>
                          <p className="text-base font-semibold">{team.name}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Status</p>
                          <Badge className="text-sm">{team.status}</Badge>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Project Title</p>
                          <p className="text-base">{team.projectTitle || "Not assigned"}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Supervisor</p>
                          <p className="text-base">{team.supervisor?.name || "Unassigned"}</p>
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Team Leader</p>
                        <p className="text-base">{team.leader?.name || "Not set"}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">Team Members</CardTitle>
                  <CardDescription>Members on the student team.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {teamError ? (
                    <p className="text-sm text-destructive">{(teamError as Error).message}</p>
                  ) : !team ? (
                    <p className="text-sm text-muted-foreground">No members available.</p>
                  ) : teamMembers?.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No members found on this team.</p>
                  ) : (
                    <div className="space-y-3">
                      {teamMembers?.map((member: any) => (
                        <div key={member.userId} className="rounded-lg border border-border p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="font-semibold">{member.user?.name || member.name || "Unknown"}</p>
                              <p className="text-sm text-muted-foreground">{member.user?.email || member.email || "No email"}</p>
                            </div>
                            <Badge variant="outline" className="text-sm">{member.role || "member"}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
