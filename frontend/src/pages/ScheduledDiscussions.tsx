import { useMemo, useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useListTeams, getListTeamsQueryKey, useListUsers, getListUsersQueryKey, ListUsersRole } from "@workspace/api-client-react";
import { fetchDiscussionSchedules, generateDiscussionSchedules, updateDiscussionSchedule, deleteDiscussionSchedule, type DiscussionScheduleSession, type DiscussionScheduleSettings, type DiscussionScheduleResponse } from "@/services/discussion-schedule";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { ArrowLeft, CalendarDays, Clock, Download, Edit3, Move, Search, Trash2, UserCheck, Users } from "lucide-react";

function timeRangeOverlaps(startA: string, endA: string, startB: string, endB: string) {
  const [aH, aM] = startA.split(":").map(Number);
  const [aHE, aME] = endA.split(":").map(Number);
  const [bH, bM] = startB.split(":").map(Number);
  const [bHE, bME] = endB.split(":").map(Number);
  const aStart = aH * 60 + aM;
  const aEnd = aHE * 60 + aME;
  const bStart = bH * 60 + bM;
  const bEnd = bHE * 60 + bME;
  return aStart < bEnd && bStart < aEnd;
}

function formatDateLabel(date: string) {
  try {
    return format(new Date(date), "EEE, MMM d");
  } catch {
    return date;
  }
}

export default function ScheduledDiscussions() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: teams, isLoading: teamsLoading } = useListTeams(undefined, { query: { queryKey: getListTeamsQueryKey() } });
  const { data: supervisors, isLoading: supervisorsLoading } = useListUsers(
    { role: ListUsersRole.supervisor },
    { query: { queryKey: getListUsersQueryKey({ role: ListUsersRole.supervisor }) } },
  );

  const { data: scheduleData, isLoading: scheduleLoading } = useQuery<DiscussionScheduleResponse, Error>({
    queryKey: ["discussions"],
    queryFn: async () => fetchDiscussionSchedules(),
  }) as UseQueryResult<DiscussionScheduleResponse, Error>;

  const generateSchedule = useMutation({
    mutationFn: generateDiscussionSchedules,
  }) as any;

  const updateSchedule = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<Omit<DiscussionScheduleSession, "id" | "team" | "supervisor" | "examiner1" | "examiner2">> }) => updateDiscussionSchedule(id, body),
  }) as any;

  const deleteSchedule = useMutation({
    mutationFn: deleteDiscussionSchedule,
  }) as any;

  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [settings, setSettings] = useState<DiscussionScheduleSettings>({
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(new Date().setDate(new Date().getDate() + 2)).toISOString().slice(0, 10),
    workStartHour: "09:00",
    workEndHour: "16:00",
    discussionDuration: 30,
    breakDuration: 10,
    roomsCount: 2,
  });
  const [search, setSearch] = useState("");
  const [filterSupervisor, setFilterSupervisor] = useState("all");
  const [filterRoom, setFilterRoom] = useState("all");
  const [editSession, setEditSession] = useState<DiscussionScheduleSession | null>(null);
  const [draggingSessionId, setDraggingSessionId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState({ room: "", date: "", startTime: "", endTime: "", examiner1Id: "", examiner2Id: "" });

  useEffect(() => {
    if (teams && selectedTeamIds.length === 0) {
      setSelectedTeamIds(teams.map((team) => team.id));
    }
  }, [teams, selectedTeamIds.length]);

  const filteredSchedules = useMemo(() => {
    const sessions = scheduleData?.schedules ?? [];
    return sessions.filter((session) => {
      const matchesSearch = search.trim().length === 0 || session.team?.name?.toLowerCase().includes(search.toLowerCase());
      const matchesSupervisor = filterSupervisor === "all" || String(session.supervisorId) === filterSupervisor;
      const matchesRoom = filterRoom === "all" || session.room === filterRoom;
      return matchesSearch && matchesSupervisor && matchesRoom;
    });
  }, [scheduleData?.schedules, search, filterSupervisor, filterRoom]);

  const conflicts = useMemo(() => {
    const roomConflictIds = new Set<number>();
    const instructorConflictIds = new Set<number>();
    const sessions = scheduleData?.schedules ?? [];

    for (let i = 0; i < sessions.length; i += 1) {
      for (let j = i + 1; j < sessions.length; j += 1) {
        const a = sessions[i];
        const b = sessions[j];
        if (a.date !== b.date) continue;
        const overlap = timeRangeOverlaps(a.startTime, a.endTime, b.startTime, b.endTime);
        if (!overlap) continue;
        if (a.room === b.room) {
          roomConflictIds.add(a.id);
          roomConflictIds.add(b.id);
        }
        const instructorsA = [a.supervisorId, a.examiner1Id, a.examiner2Id];
        const instructorsB = [b.supervisorId, b.examiner1Id, b.examiner2Id];
        if (instructorsA.some((id) => instructorsB.includes(id))) {
          instructorConflictIds.add(a.id);
          instructorConflictIds.add(b.id);
        }
      }
    }

    return { roomConflictIds, instructorConflictIds };
  }, [scheduleData?.schedules]);

  const teamOptions = useMemo(() => teams ?? [], [teams]);

  const summary = useMemo(() => {
    const sessions = scheduleData?.schedules ?? [];
    const examinerCounts = new Map<number, number>();
    const dailyDistribution = new Map<string, number>();
    const roomUtilization = new Map<string, number>();

    for (const session of sessions) {
      examinerCounts.set(session.examiner1Id, (examinerCounts.get(session.examiner1Id) ?? 0) + 1);
      examinerCounts.set(session.examiner2Id, (examinerCounts.get(session.examiner2Id) ?? 0) + 1);
      dailyDistribution.set(session.date, (dailyDistribution.get(session.date) ?? 0) + 1);
      roomUtilization.set(session.room, (roomUtilization.get(session.room) ?? 0) + 1);
    }

    return {
      examinerCounts: Array.from(examinerCounts.entries()).map(([id, count]) => ({ id, count })),
      dailyDistribution: Array.from(dailyDistribution.entries()),
      roomUtilization: Array.from(roomUtilization.entries()),
    };
  }, [scheduleData?.schedules]);

  const handleToggleTeam = (teamId: number) => {
    setSelectedTeamIds((current) =>
      current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId],
    );
  };

  const handleSelectAllTeams = () => {
    if (!teams) return;
    setSelectedTeamIds(teams.map((team) => team.id));
  };

  const handleClearTeams = () => {
    setSelectedTeamIds([]);
  };

  const handleGenerate = async () => {
    try {
      await generateSchedule.mutateAsync({
        ...settings,
        includedTeamIds: selectedTeamIds.length === teams?.length ? undefined : selectedTeamIds,
      });
      queryClient.invalidateQueries({ queryKey: ["discussions"] });
      toast({ title: "Schedule created", description: "Graduation project discussions were generated successfully." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to generate schedule.", variant: "destructive" });
    }
  };

  const handleEditOpen = (session: DiscussionScheduleSession) => {
    setEditSession(session);
    setEditValues({
      room: session.room,
      date: session.date,
      startTime: session.startTime,
      endTime: session.endTime,
      examiner1Id: String(session.examiner1Id),
      examiner2Id: String(session.examiner2Id),
    });
  };

  const handleEditSave = async () => {
    if (!editSession) return;
    if (editValues.examiner1Id === editValues.examiner2Id) {
      toast({ title: "Error", description: "Examiner 1 and Examiner 2 must be different.", variant: "destructive" });
      return;
    }
    try {
      await updateSchedule.mutateAsync({
        id: editSession.id,
        body: {
          room: editValues.room,
          date: editValues.date,
          startTime: editValues.startTime,
          endTime: editValues.endTime,
          examiner1Id: Number(editValues.examiner1Id),
          examiner2Id: Number(editValues.examiner2Id),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["discussions"] });
      setEditSession(null);
      toast({ title: "Session updated", description: "The discussion session was updated successfully." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to save changes.", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteSchedule.mutateAsync(id);
      queryClient.invalidateQueries({ queryKey: ["discussions"] });
      toast({ title: "Session removed", description: "The discussion session was deleted." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to delete session.", variant: "destructive" });
    }
  };

  const handleDragStart = (sessionId: number) => {
    setDraggingSessionId(sessionId);
  };

  const handleDropOnSession = async (targetId: number) => {
    if (!draggingSessionId || draggingSessionId === targetId) {
      setDraggingSessionId(null);
      return;
    }
    const sessions = scheduleData?.schedules ?? [];
    const source = sessions.find((session) => session.id === draggingSessionId);
    const target = sessions.find((session) => session.id === targetId);
    if (!source || !target) {
      setDraggingSessionId(null);
      return;
    }

    try {
      await updateSchedule.mutateAsync({
        id: source.id,
        body: {
          room: target.room,
          date: target.date,
          startTime: target.startTime,
          endTime: target.endTime,
        },
      });
      await updateSchedule.mutateAsync({
        id: target.id,
        body: {
          room: source.room,
          date: source.date,
          startTime: source.startTime,
          endTime: source.endTime,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["discussions"] });
      toast({ title: "Session moved", description: "The two discussion slots were swapped." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to move session.", variant: "destructive" });
    } finally {
      setDraggingSessionId(null);
    }
  };

  const exportCsv = () => {
    const rows = [
      ["Team", "Supervisor", "Examiner 1", "Examiner 2", "Room", "Date", "Start Time", "End Time"],
      ...(scheduleData?.schedules ?? []).map((session) => [
        session.team?.name ?? "",
        session.supervisor?.name ?? "",
        session.examiner1?.name ?? "",
        session.examiner2?.name ?? "",
        session.room,
        session.date,
        session.startTime,
        session.endTime,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "scheduled-discussions.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (user?.role !== "coordinator") {
    return (
      <AppLayout title="Scheduled Discussions">
        <div className="flex h-full items-center justify-center p-12">
          <Card className="max-w-lg w-full">
            <CardHeader>
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>Only coordinators can manage discussion schedules.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Scheduled Discussions">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Scheduled Discussions</h2>
            <p className="text-muted-foreground max-w-2xl">Generate and manage defense sessions, assign examiners, and resolve conflicts before the event.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={exportCsv}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="secondary" className="gap-2" onClick={() => window.print()}>
              <Move className="h-4 w-4" /> Print / PDF
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.5fr,1fr]">
          <Card className="space-y-4">
            <CardHeader>
              <CardTitle>Schedule Settings</CardTitle>
              <CardDescription>Choose parameters and team selection for automated scheduling.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="startDate">Start date</Label>
                  <Input id="startDate" type="date" value={settings.startDate} onChange={(event) => setSettings({ ...settings, startDate: event.target.value })} />
                </div>
                <div>
                  <Label htmlFor="endDate">End date</Label>
                  <Input id="endDate" type="date" value={settings.endDate} onChange={(event) => setSettings({ ...settings, endDate: event.target.value })} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="workStartHour">Daily start hour</Label>
                  <Input id="workStartHour" type="time" value={settings.workStartHour} onChange={(event) => setSettings({ ...settings, workStartHour: event.target.value })} />
                </div>
                <div>
                  <Label htmlFor="workEndHour">Daily end hour</Label>
                  <Input id="workEndHour" type="time" value={settings.workEndHour} onChange={(event) => setSettings({ ...settings, workEndHour: event.target.value })} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="discussionDuration">Discussion duration</Label>
                  <Input id="discussionDuration" type="number" min={10} step={5} value={settings.discussionDuration} onChange={(event) => setSettings({ ...settings, discussionDuration: Number(event.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="breakDuration">Break duration</Label>
                  <Input id="breakDuration" type="number" min={0} step={5} value={settings.breakDuration} onChange={(event) => setSettings({ ...settings, breakDuration: Number(event.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="roomsCount">Rooms</Label>
                  <Input id="roomsCount" type="number" min={1} step={1} value={settings.roomsCount} onChange={(event) => setSettings({ ...settings, roomsCount: Number(event.target.value) })} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Included teams</Label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleSelectAllTeams}>Select all</Button>
                    <Button size="sm" variant="outline" onClick={handleClearTeams}>Clear</Button>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto rounded-lg border p-3 bg-background">
                  {teamsLoading ? (
                    <Skeleton className="h-40 w-full" />
                  ) : teams?.length ? (
                    <div className="space-y-2">
                      {teamOptions.map((team) => (
                        <label key={team.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selectedTeamIds.includes(team.id)}
                            onChange={() => handleToggleTeam(team.id)}
                            className="h-4 w-4 rounded border-muted-foreground"
                          />
                          <span>{team.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No teams available.</p>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <Button onClick={handleGenerate} disabled={generateSchedule.isLoading || teamsLoading || supervisorsLoading || selectedTeamIds.length === 0}>
                {generateSchedule.isLoading ? "Generating..." : "Generate Schedule"}
              </Button>
              <div className="text-sm text-muted-foreground">
                {selectedTeamIds.length} team(s) selected · {supervisors?.length ?? 0} supervisors available
              </div>
            </CardFooter>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Fairness Statistics</CardTitle>
                <CardDescription>Balanced load across examiners, rooms, and days.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium">Examiner workload</h3>
                  <div className="space-y-2 mt-3">
                    {summary.examinerCounts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No sessions yet.</p>
                    ) : (
                      summary.examinerCounts.map((item) => {
                        const examiner = supervisors?.find((sup) => sup.id === item.id);
                        return (
                          <div key={item.id} className="flex justify-between text-sm">
                            <span>{examiner?.name ?? `Instructor ${item.id}`}</span>
                            <span className="font-medium">{item.count}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-medium">Daily distribution</h3>
                  <div className="space-y-2 mt-3">
                    {summary.dailyDistribution.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No sessions yet.</p>
                    ) : (
                      summary.dailyDistribution.map(([date, count]) => (
                        <div key={date} className="flex justify-between text-sm">
                          <span>{formatDateLabel(date)}</span>
                          <span className="font-medium">{count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-medium">Room utilization</h3>
                  <div className="space-y-2 mt-3">
                    {summary.roomUtilization.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No sessions yet.</p>
                    ) : (
                      summary.roomUtilization.map(([room, count]) => (
                        <div key={room} className="flex justify-between text-sm">
                          <span>{room}</span>
                          <span className="font-medium">{count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <CardTitle>Schedule Table</CardTitle>
              <CardDescription>Browse, filter, and edit discussion sessions.</CardDescription>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 w-full sm:w-auto">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search team" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <Select value={filterSupervisor} onValueChange={setFilterSupervisor}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Filter supervisor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All supervisors</SelectItem>
                  {supervisors?.map((sup) => (
                    <SelectItem key={sup.id} value={String(sup.id)}>{sup.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterRoom} onValueChange={setFilterRoom}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Filter room" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All rooms</SelectItem>
                  {Array.from(new Set(scheduleData?.schedules?.map((item) => item.room) ?? [])).map((room) => (
                    <SelectItem key={room} value={room}>{room}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          <CardContent className="overflow-x-auto">
            {scheduleLoading ? (
              <div className="space-y-3 py-8">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : filteredSchedules.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No scheduled discussions found.</p>
            ) : (
              <Table className="min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead>Team</TableHead>
                    <TableHead>Supervisor</TableHead>
                    <TableHead>Examiner 1</TableHead>
                    <TableHead>Examiner 2</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSchedules.map((session) => {
                    const roomConflict = conflicts.roomConflictIds.has(session.id);
                    const instructorConflict = conflicts.instructorConflictIds.has(session.id);
                    return (
                      <TableRow
                        key={session.id}
                        draggable
                        onDragStart={() => handleDragStart(session.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => handleDropOnSession(session.id)}
                        className={roomConflict || instructorConflict ? "bg-red-50" : ""}
                      >
                        <TableCell className="max-w-xs truncate">{session.team?.name}</TableCell>
                        <TableCell>{session.supervisor?.name}</TableCell>
                        <TableCell>{session.examiner1?.name}</TableCell>
                        <TableCell>{session.examiner2?.name}</TableCell>
                        <TableCell>{formatDateLabel(session.date)}</TableCell>
                        <TableCell>{session.startTime} - {session.endTime}</TableCell>
                        <TableCell>{session.room}</TableCell>
                        <TableCell className="text-right space-x-2">
                          {roomConflict && <Badge variant="destructive">Room</Badge>}
                          {instructorConflict && <Badge variant="destructive">Instructor</Badge>}
                          <Button size="sm" variant="outline" onClick={() => handleEditOpen(session)}><Edit3 className="h-4 w-4" /></Button>
                          <Button size="sm" variant="outline" onClick={() => handleDelete(session.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={Boolean(editSession)} onOpenChange={(open) => { if (!open) setEditSession(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Discussion Session</DialogTitle>
              <DialogDescription>Change timing, room, or examiners for this session.</DialogDescription>
            </DialogHeader>
            {editSession && (
              <div className="space-y-4 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="editDate">Date</Label>
                    <Input id="editDate" type="date" value={editValues.date} onChange={(event) => setEditValues({ ...editValues, date: event.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="editRoom">Room</Label>
                    <Input id="editRoom" value={editValues.room} onChange={(event) => setEditValues({ ...editValues, room: event.target.value })} />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="editStartTime">Start time</Label>
                    <Input id="editStartTime" type="time" value={editValues.startTime} onChange={(event) => setEditValues({ ...editValues, startTime: event.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="editEndTime">End time</Label>
                    <Input id="editEndTime" type="time" value={editValues.endTime} onChange={(event) => setEditValues({ ...editValues, endTime: event.target.value })} />
                  </div>
                  <div>
                    <Label>Supervisor</Label>
                    <Input value={editSession.supervisor?.name ?? ""} disabled />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="examiner1">Examiner 1</Label>
                    <Select value={editValues.examiner1Id} onValueChange={(value) => setEditValues({ ...editValues, examiner1Id: value })}>
                      <SelectTrigger id="examiner1">
                        <SelectValue placeholder="Select examiner 1" />
                      </SelectTrigger>
                      <SelectContent>
                        {supervisors?.filter((sup) => sup.id !== editSession.supervisorId).map((sup) => (
                          <SelectItem key={sup.id} value={String(sup.id)}>{sup.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="examiner2">Examiner 2</Label>
                    <Select value={editValues.examiner2Id} onValueChange={(value) => setEditValues({ ...editValues, examiner2Id: value })}>
                      <SelectTrigger id="examiner2">
                        <SelectValue placeholder="Select examiner 2" />
                      </SelectTrigger>
                      <SelectContent>
                        {supervisors?.filter((sup) => sup.id !== editSession.supervisorId).map((sup) => (
                          <SelectItem key={sup.id} value={String(sup.id)}>{sup.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
            <DialogFooter className="space-x-2">
              <Button variant="outline" onClick={() => setEditSession(null)}>Cancel</Button>
              <Button onClick={handleEditSave} disabled={updateSchedule.isLoading}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
