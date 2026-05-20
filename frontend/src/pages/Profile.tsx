import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetMyProfile, useUpdateMyProfile, getGetMyProfileQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { User as UserIcon, Book, Star, FileText, GraduationCap, Trash2, Plus, X } from "lucide-react";
import StudentIdBadge from "@/components/StudentIdBadge";
import { format } from "date-fns";

const profileSchema = z.object({
  gpa: z.coerce.number().min(0).max(4.2).optional().nullable(),
  skills: z.string().optional().nullable(),
  interests: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function Profile() {
  const { user } = useAuth();
  const { data: profile, isLoading } = useGetMyProfile({
    query: {
      queryKey: getGetMyProfileQueryKey(),
      enabled: user?.role === 'student',
    }
  });
  const updateProfile = useUpdateMyProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      gpa: null,
      skills: "",
      interests: "",
      description: "",
    },
  });

  useEffect(() => {
    if (profile) {
      form.reset({
        gpa: profile.gpa,
        skills: profile.skills || "",
        interests: profile.interests || "",
        description: profile.description || "",
      });
    }
  }, [profile, form]);

  if (!user) return null;

  if (user.role === 'supervisor') {
    return <SupervisorOfficeHoursEditor />;
  }

  if (user.role !== 'student') {
    return (
      <AppLayout title="Profile">
        <Card className="max-w-2xl mx-auto mt-8">
          <CardHeader>
            <CardTitle>User Profile</CardTitle>
            <CardDescription>Your account details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 border-b pb-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-bold">
                {user.name.charAt(0)}
              </div>
              <div>
                <h3 className="text-xl font-bold">{user.name}</h3>
                <p className="text-muted-foreground">{user.email}</p>
                {/* show student id badge when available */}
                {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
                {/* @ts-ignore */}
                <StudentIdBadge userId={user.id} />
                <div className="mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground">
                  {user.role}
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground pt-2">
              Detailed profiles are currently only available for student accounts.
            </p>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  const onSubmit = async (data: ProfileFormValues) => {
    try {
      await updateProfile.mutateAsync({ data });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast({
        title: "Profile updated",
        description: "Your student profile has been saved successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <AppLayout title="Student Profile">
      <div className="max-w-3xl mx-auto space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-6">
              <div className="h-20 w-20 rounded-full bg-primary/10 flex shrink-0 items-center justify-center text-primary text-3xl font-bold">
                {user.name.charAt(0)}
              </div>
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">{user.name}</h2>
                <p className="text-muted-foreground flex items-center gap-2">
                  <UserIcon className="h-4 w-4" /> {user.email}
                </p>
                {profile?.studentId ? (
                  <div className="mt-1">
                    <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                      ID: {profile.studentId}
                    </span>
                  </div>
                ) : (
                  /* fallback: try fetching via badge for non-student or missing profile */
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-ignore
                  <StudentIdBadge userId={user.id} />
                )}
                <div className="pt-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10 dark:bg-blue-900/30 dark:text-blue-400">
                    Student
                  </span>
                  {profile?.gpa && (
                    <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20 dark:bg-green-900/30 dark:text-green-400">
                      GPA: {profile.gpa}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2"><Skeleton className="h-4 w-16" /><Skeleton className="h-10 w-full" /></div>
              <div className="space-y-2"><Skeleton className="h-4 w-16" /><Skeleton className="h-10 w-full" /></div>
              <div className="space-y-2"><Skeleton className="h-4 w-16" /><Skeleton className="h-24 w-full" /></div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Academic Details</CardTitle>
              <CardDescription>
                Help supervisors and potential teammates learn more about your background.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <div className="grid gap-6 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="gpa"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            <GraduationCap className="h-4 w-4 text-muted-foreground" />
                            GPA
                          </FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              step="0.01" 
                              min="0" 
                              max="4.2" 
                              placeholder="3.8" 
                              {...field} 
                              value={field.value || ''} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="skills"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            <Star className="h-4 w-4 text-muted-foreground" />
                            Skills
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="React, Python, Machine Learning..." {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="interests"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Book className="h-4 w-4 text-muted-foreground" />
                          Research Interests
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Computer Vision, Distributed Systems..." {...field} value={field.value || ''} />
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
                        <FormLabel className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          About Me
                        </FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Brief description of your background and what you're looking for in a graduation project..." 
                            className="min-h-30"
                            {...field}
                            value={field.value || ''} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end">
                    <Button type="submit" disabled={updateProfile.isPending}>
                      {updateProfile.isPending ? "Saving..." : "Save Profile"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

function SupervisorOfficeHoursEditor() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const parseStoredHours = (stored: string | null | undefined) => {
    if (!stored) return [];
    const map = new Map<string, { day: number; month: number; year: number; periods: { start: number; end: number }[] }>();

    stored
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((dateTimeStr) => {
        const date = new Date(dateTimeStr);
        const day = date.getDate();
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        const hour = date.getHours();
        const key = `${year}-${month}-${day}`;

        if (!map.has(key)) {
          map.set(key, { day, month, year, periods: [] });
        }
        // create a default 1-hour period from the stored hour
        map.get(key)!.periods.push({ start: hour, end: Math.min(23, hour + 1) });
      });

    return Array.from(map.values()).sort((a, b) => {
      const dateA = new Date(a.year, a.month - 1, a.day);
      const dateB = new Date(b.year, b.month - 1, b.day);
      return dateA.getTime() - dateB.getTime();
    });
  };

  const formatToDateTimeLocal = (dates: z.infer<typeof officeHoursSchema>["dates"]) => {
    return dates
      .flatMap((dateSlot) =>
        dateSlot.periods.flatMap((period) => {
          const hour = period.start;
          const date = new Date(dateSlot.year, dateSlot.month - 1, dateSlot.day, hour, 0);
          const iso = date.toISOString().split("T");
          return `${iso[0]}T${String(hour).padStart(2, "0")}:00`;
        })
      )
      .join("\n");
  };

  const officeHoursSchema = z.object({
    dates: z.array(
      z.object({
        day: z.coerce.number().min(1).max(31),
        month: z.coerce.number().min(1).max(12),
        year: z.coerce.number().min(2000).max(2100),
        periods: z.array(
          z
            .object({
              start: z.coerce.number().min(0).max(23),
              end: z.coerce.number().min(0).max(23),
            })
            .refine((p) => p.end > p.start, {
              message: "End must be greater than start",
              path: ["end"],
            })
        ).min(1),
      })
    ),
  });

  const form = useForm<z.infer<typeof officeHoursSchema>>({
    resolver: zodResolver(officeHoursSchema),
    defaultValues: {
      dates: parseStoredHours(user?.officeHours),
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "dates",
  });

  useEffect(() => {
    form.reset({ dates: parseStoredHours(user?.officeHours) });
  }, [form, user?.officeHours]);

  if (!user) return null;

  const onSubmit = async (data: z.infer<typeof officeHoursSchema>) => {
    try {
      setIsSaving(true);
      const officeHoursString = formatToDateTimeLocal(data.dates);

      const response = await fetch("/api/auth/me", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officeHours: officeHoursString }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || "Failed to update office hours");
      }

      const updatedUser = await response.json();
      queryClient.setQueryData(getGetMeQueryKey(), updatedUser);
      toast({ title: "Office hours updated", description: "Students can now see your available slots." });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update office hours.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const months = [
    { value: 1, label: "January" },
    { value: 2, label: "February" },
    { value: 3, label: "March" },
    { value: 4, label: "April" },
    { value: 5, label: "May" },
    { value: 6, label: "June" },
    { value: 7, label: "July" },
    { value: 8, label: "August" },
    { value: 9, label: "September" },
    { value: 10, label: "October" },
    { value: 11, label: "November" },
    { value: 12, label: "December" },
  ];

  const hours = Array.from({ length: 24 }, (_, i) => ({
    value: i,
    label: `${String(i).padStart(2, "0")}:00`,
  }));

  const getDaysWithWeekday = (month: number, year: number) => {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return Array.from({ length: 31 }, (_, i) => {
      const dayNum = i + 1;
      const date = new Date(year, month - 1, dayNum);
      const dayOfWeek = dayNames[date.getDay()];
      return {
        value: dayNum,
        label: `${dayNum} - ${dayOfWeek}`,
      };
    });
  };

  return (
    <AppLayout title="Office Hours Management">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-6">
              <div className="h-20 w-20 rounded-full bg-primary/10 flex shrink-0 items-center justify-center text-primary text-3xl font-bold">
                {user.name.charAt(0)}
              </div>
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">{user.name}</h2>
                <p className="text-muted-foreground flex items-center gap-2">
                  <UserIcon className="h-4 w-4" /> {user.email}
                </p>
                <div className="pt-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10 dark:bg-indigo-900/30 dark:text-indigo-400">
                    Supervisor
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card> */}

        <Card>
          <CardHeader>
            <CardTitle>Office Hours</CardTitle>
            <CardDescription>
              Set your available meeting slots. Multiple hours can be added for the same date. Students will see these times when requesting meetings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {fields.length === 0 ? (
                  <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center">
                    <p className="text-sm text-muted-foreground mb-4">No office hours scheduled yet.</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        append({
                          day: new Date().getDate(),
                          month: new Date().getMonth() + 1,
                          year: new Date().getFullYear(),
                          periods: [{ start: 10, end: 11 }],
                        })
                      }
                      className="gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Add First Date
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {fields.map((field, dateIndex) => (
                      <DateWithPeriodsEditor
                        key={field.id}
                        dateIndex={dateIndex}
                        form={form}
                        remove={remove}
                        months={months}
                        hours={hours}
                        getDaysWithWeekday={getDaysWithWeekday}
                      />
                    ))}
                  </div>
                )}

                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <p className="text-sm font-medium">Preview</p>
                  {fields.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No office hours configured yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                          {(() => {
                            const watchedDates = form.watch("dates") || [];
                            return watchedDates.flatMap((dateSlot: any, idx: number) =>
                              (dateSlot.periods || []).flatMap((period: any, periodIdx: number) => {
                                const date = new Date(dateSlot.year, dateSlot.month - 1, dateSlot.day, period.start);
                                if (isNaN(date.getTime())) return null;
                                return (
                                  <span
                                    key={`${idx}-${periodIdx}`}
                                    className="inline-flex items-center rounded-full bg-background px-3 py-1 text-xs border"
                                  >
                                    {format(date, "MMM d, yyyy h:mm a")}
                                  </span>
                                );
                              })
                            );
                          })()}
                    </div>
                  )}
                </div>

                <div className="flex gap-3 justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      append({
                        day: new Date().getDate(),
                        month: new Date().getMonth() + 1,
                        year: new Date().getFullYear(),
                        periods: [{ start: 10, end: 11 }],
                      })
                    }
                    className="gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add Another Date
                  </Button>
                  <Button type="submit" disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save Office Hours"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function DateWithPeriodsEditor({ dateIndex, form, remove, months, hours, getDaysWithWeekday }: DateWithHoursEditorProps) {
  const { fields: periodFields, append: appendPeriod, remove: removePeriod } = useFieldArray({
    control: form.control,
    name: `dates.${dateIndex}.periods`,
  });

  const selectedMonth = form.watch(`dates.${dateIndex}.month`) ?? (new Date().getMonth() + 1);
  const selectedYear = form.watch(`dates.${dateIndex}.year`) ?? new Date().getFullYear();
  const daysWithWeekday = getDaysWithWeekday(selectedMonth, selectedYear);

  return (
    <div className="rounded-lg border p-4 space-y-4 bg-muted/30">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium">
          Date: {form.watch(`dates.${dateIndex}.day`)} - {months.find((m: any) => m.value === form.watch(`dates.${dateIndex}.month`))?.label} {form.watch(`dates.${dateIndex}.year`)}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => remove(dateIndex)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <FormField
          control={form.control}
          name={`dates.${dateIndex}.day`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Day</FormLabel>
              <Select
                    value={String(field.value ?? "")}
                      onValueChange={(value) => field.onChange(value === "" ? undefined : parseInt(value))}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="max-h-48">
                  {daysWithWeekday.map((day: any) => (
                    <SelectItem key={day.value} value={String(day.value)}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name={`dates.${dateIndex}.month`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Month</FormLabel>
              <Select
                    value={String(field.value ?? "")}
                      onValueChange={(value) => field.onChange(value === "" ? undefined : parseInt(value))}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="max-h-48">
                  {months.map((month: any) => (
                    <SelectItem key={month.value} value={String(month.value)}>
                      {month.label.slice(0, 3)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name={`dates.${dateIndex}.year`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Year</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={2000}
                  max={2100}
                  {...field}
                />
              </FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
      </div>

      <div className="space-y-3 pt-3 border-t">
        <p className="text-xs font-medium">Time Slots</p>
        <div className="space-y-2">
          {periodFields.map((periodField, periodIndex) => (
            <div key={periodField.id} className="flex gap-2 items-end">
              <FormField
                control={form.control}
                name={`dates.${dateIndex}.periods.${periodIndex}.start`}
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel className="text-xs">Start</FormLabel>
                    <Select
                          value={String(field.value ?? "")}
                            onValueChange={(value) => field.onChange(value === "" ? undefined : parseInt(value))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-48">
                        {hours.map((hour: any) => (
                          <SelectItem key={hour.value} value={String(hour.value)}>
                            {hour.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`dates.${dateIndex}.periods.${periodIndex}.end`}
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel className="text-xs">End</FormLabel>
                    <Select
                      value={String(field.value ?? "")}
                      onValueChange={(value) => field.onChange(value === "" ? undefined : parseInt(value))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-48">
                        {hours.map((hour: any) => (
                          <SelectItem key={hour.value} value={String(hour.value)}>
                            {hour.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removePeriod(periodIndex)}
                className="text-destructive hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => appendPeriod({ start: 10, end: 11 })}
          className="gap-2 w-full"
        >
          <Plus className="h-3 w-3" />
          Add Another Time Slot
        </Button>
      </div>
    </div>
  );
}
