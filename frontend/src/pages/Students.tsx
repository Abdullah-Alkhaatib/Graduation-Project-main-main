import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import {
  useListProfiles,
  getListProfilesQueryKey,
  useListUsers,
  getListUsersQueryKey,
  ListUsersRole,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, User, Star, Book } from "lucide-react";
import * as XLSX from "xlsx";
import { useMemo, useState, useEffect } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import { useLocation } from "wouter";

interface CoordinatorStudentRow {
  userId: number;
  name: string;
  email: string;
  studentId: string | null;
  teamId: number | null;
  teamName: string | null;
  supervisorId: number | null;
  supervisorName: string | null;
  teamStatus: string | null;
}

export default function Students() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [skills, setSkills] = useState("");
  const [minGpa, setMinGpa] = useState<string>("");
  const [supervisorFilter, setSupervisorFilter] = useState<string>("");
  const [teamRegistrationFilter, setTeamRegistrationFilter] = useState<string>("");
  const [studentRows, setStudentRows] = useState<CoordinatorStudentRow[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search.trim(), 300);
  const debouncedSkills = useDebounce(skills.trim(), 300);
  const parsedMinGpa = minGpa.trim() ? Number(minGpa) : undefined;
  const minGpaFilter = Number.isFinite(parsedMinGpa) ? parsedMinGpa : undefined;

  const { data: supervisors, isLoading: supervisorsLoading } = useListUsers(
    { role: ListUsersRole.supervisor },
    {
      query: {
        queryKey: getListUsersQueryKey({ role: ListUsersRole.supervisor }),
        enabled: user?.role === "coordinator",
      },
    }
  );

  const { data: profiles, isLoading } = useListProfiles(
    {
      search: debouncedSearch || undefined,
      skills: debouncedSkills || undefined,
      minGpa: minGpaFilter,
    },
    {
      query: {
        queryKey: getListProfilesQueryKey({
          search: debouncedSearch || undefined,
          skills: debouncedSkills || undefined,
          minGpa: minGpaFilter,
        }),
        enabled: user?.role === "supervisor" || user?.role === "coordinator",
      },
    }
  );

  useEffect(() => {
    if (user?.role !== "coordinator") {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams();
    if (supervisorFilter) {
      params.set("supervisorId", supervisorFilter);
    }

    setStudentsLoading(true);
    setStudentsError(null);

    fetch(`/api/coordinator/student-profiles${params.toString() ? `?${params.toString()}` : ""}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Failed to load student list");
        }
        return response.json();
      })
      .then((data) => {
        setStudentRows(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setStudentsError(error.message || "Failed to load student list");
        }
      })
      .finally(() => setStudentsLoading(false));

    return () => controller.abort();
  }, [supervisorFilter, user?.role]);

  const coordinatorRows = useMemo(() => {
    return Array.isArray(studentRows) ? studentRows : [];
  }, [studentRows]);

  const filteredCoordinatorRows = useMemo(() => {
    return coordinatorRows.filter((row) => {
      if (teamRegistrationFilter === "registered" && row.teamId == null) {
        return false;
      }
      if (teamRegistrationFilter === "unregistered" && row.teamId != null) {
        return false;
      }
      return true;
    });
  }, [coordinatorRows, teamRegistrationFilter]);

  const exportToExcel = () => {
    const rows = filteredCoordinatorRows.map((row) => ({
      Name: row.name,
      "Student ID": row.studentId || "-",
      Email: row.email,
      "Team Name": row.teamName || "No team",
      "Supervisor Name": row.supervisorName || "Unassigned",
      "Team Status": row.teamStatus || "Unknown",
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Students");
    XLSX.writeFile(workbook, "students.xlsx");
  };

  const profilesList = useMemo(() => {
    const rawProfiles = Array.isArray(profiles) ? profiles : [];
    const searchFilter = search.trim().toLowerCase();
    const skillsFilter = skills.trim().toLowerCase();
    const gpaFilter = Number.isFinite(parsedMinGpa) ? parsedMinGpa : undefined;

    return rawProfiles.filter((profile) => {
      const studentIdStr = (profile.studentId ?? "").toString().toLowerCase();
      const matchesNameOrId = !searchFilter || profile.user.name.toLowerCase().includes(searchFilter) || studentIdStr.includes(searchFilter);
      const matchesSkills = !skillsFilter || (profile.skills ?? "").toLowerCase().includes(skillsFilter);
      const matchesGpa = gpaFilter === undefined || ((profile.gpa ?? -Infinity) >= gpaFilter);
      return matchesNameOrId && matchesSkills && matchesGpa;
    });
  }, [profiles, search, skills, parsedMinGpa]);

  const showEmptyState = !isLoading && profilesList.length === 0;

  if (user?.role === "student") {
    return (
      <AppLayout title="Students">
        <div className="flex flex-col items-center justify-center p-12 text-center bg-card rounded-lg border border-dashed mt-8">
          <h2 className="text-2xl font-bold tracking-tight">Access Denied</h2>
          <p className="text-muted-foreground max-w-md mt-2 mb-6">
            Only supervisors and coordinators can browse all students.
          </p>
        </div>
      </AppLayout>
    );
  }

  if (user?.role === "coordinator") {
    return (
      <AppLayout title="Students List">
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Students List</h2>
              <p className="text-muted-foreground">Browse all registered students and jump to student details.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={exportToExcel}
                className="inline-flex items-center justify-center rounded-lg border border-input bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Export to Excel
              </button>
              <div className="w-full max-w-xs">
                <label htmlFor="supervisorFilter" className="text-sm font-medium text-muted-foreground">
                  Filter by Supervisor
                </label>
                <select
                  id="supervisorFilter"
                  value={supervisorFilter}
                  onChange={(e) => setSupervisorFilter(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
                  disabled={supervisorsLoading}
                >
                  <option value="">All Supervisors</option>
                  {Array.isArray(supervisors) && supervisors.map((sup) => (
                    <option key={sup.id} value={sup.id}>{sup.name}</option>
                  ))}
                </select>
              </div>
              <div className="w-full max-w-xs">
                <label htmlFor="teamRegistrationFilter" className="text-sm font-medium text-muted-foreground">
                  Filter by Team Registration
                </label>
                <select
                  id="teamRegistrationFilter"
                  value={teamRegistrationFilter}
                  onChange={(e) => setTeamRegistrationFilter(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
                >
                  <option value="">All Teams</option>
                  <option value="registered">Registered Teams</option>
                  <option value="unregistered">Unregistered Teams</option>
                </select>
              </div>
            </div>
          </div>

          <Card className="border-primary/10 shadow-sm overflow-x-auto">
            <CardContent className="p-0">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Student Name</th>
                    <th className="px-4 py-3">Student ID</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Team Name</th>
                    <th className="px-4 py-3">Supervisor Name</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {studentsLoading ? (
                    [...Array(6)].map((_, idx) => (
                      <tr key={idx} className="animate-pulse">
                        {[...Array(5)].map((_, cellIndex) => (
                          <td key={cellIndex} className="px-4 py-4">
                            <div className="h-4 w-full rounded bg-slate-200" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : studentsError ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-destructive">
                        {studentsError}
                      </td>
                    </tr>
                  ) : filteredCoordinatorRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No students found for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredCoordinatorRows.map((row) => (
                      <tr
                        key={row.userId}
                        className="cursor-pointer transition hover:bg-slate-50"
                        onClick={() => navigate(`/students/${row.userId}`)}
                      >
                        <td className="px-4 py-4 font-medium text-slate-900">{row.name}</td>
                        <td className="px-4 py-4 text-slate-600">{row.studentId || "-"}</td>
                        <td className="px-4 py-4 text-slate-600">{row.email}</td>
                        <td className="px-4 py-4 text-slate-600">{row.teamName || "No team"}</td>
                        <td className="px-4 py-4 text-slate-600">{row.supervisorName || "Unassigned"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Browse Students">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Student Directory</h2>
        </div>

        <Card className="border-primary/10 shadow-sm">
          <CardContent className="p-4 grid gap-4 md:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or ID..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Skeleton className="h-12 w-12 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  </div>
                  <Skeleton className="h-20 w-full mt-4" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        {showEmptyState ? (
          <div className="flex flex-col items-center justify-center p-12 text-center bg-card rounded-lg border border-dashed">
            <User className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No students found</h3>
            <p className="text-muted-foreground max-w-sm mt-1">
              Try adjusting your filters to find more students.
            </p>
          </div>
        ) : null}

        {!isLoading && !showEmptyState ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {profilesList.map((profile) => (
              <Card key={profile.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {(profile.user.name?.charAt(0) || "U").toUpperCase()}
                      </div>
                      <div>
                        <CardTitle className="text-base">{profile.user.name}</CardTitle>
                        <CardDescription className="text-xs">{profile.user.email}</CardDescription>
                        {profile.studentId && (
                          <div className="text-xs text-muted-foreground mt-1">ID: {profile.studentId}</div>
                        )}
                      </div>
                    </div>
                    {profile.gpa && (
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        GPA: {profile.gpa}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-4 pb-4 text-sm">
                  {profile.skills && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <Star className="h-3 w-3" /> Skills
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {profile.skills.split(",").slice(0, 5).map((skill, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                            {skill.trim()}
                          </Badge>
                        ))}
                        {profile.skills.split(",").length > 5 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">...</Badge>
                        )}
                      </div>
                    </div>
                  )}
                  {profile.interests && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <Book className="h-3 w-3" /> Interests
                      </p>
                      <p className="line-clamp-2 text-muted-foreground text-xs">{profile.interests}</p>
                    </div>
                  )}
                  {profile.description && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">About</p>
                      <p className="line-clamp-2 text-muted-foreground text-xs italic">"{profile.description}"</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}
      </div>
    </AppLayout>
  );
}
