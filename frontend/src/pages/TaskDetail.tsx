import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { 
  useGetTask, 
  getGetTaskQueryKey, 
  useReviewSubmission,
  useUpdateTask,
  type Submission,
  TaskStatus,
  SubmissionStatus,
  UpdateTaskBodyStatus
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { CheckSquare, Calendar, ArrowLeft, FileText, CheckCircle2, XCircle, Clock, Download } from "lucide-react";
import { format } from "date-fns";

const submitSchema = z.object({
  notes: z.string().optional(),
});

const reviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  feedback: z.string().min(2, "Feedback is required"),
});

export default function TaskDetail() {
  const { id } = useParams();
  const taskId = parseInt(id || "0", 10);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [reviewingSubmissionId, setReviewingSubmissionId] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  const { data: task, isLoading: taskLoading } = useGetTask(taskId, {
    query: {
      enabled: !!taskId,
      queryKey: getGetTaskQueryKey(taskId),
    }
  });

  const taskSubmissionsQueryKey = ["task-submissions", taskId] as const;

  const { data: submissions, isLoading: submissionsLoading } = useQuery<Submission[]>({
    queryKey: taskSubmissionsQueryKey,
    enabled: !!taskId,
    queryFn: async () => {
      const response = await fetch(`/api/submissions?taskId=${taskId}`);
      if (!response.ok) {
        throw new Error(`Failed to load submissions (${response.status})`);
      }
      return response.json() as Promise<Submission[]>;
    },
  });

  const reviewSubmission = useReviewSubmission();
  const updateTask = useUpdateTask();

  const submitForm = useForm<z.infer<typeof submitSchema>>({
    resolver: zodResolver(submitSchema),
    defaultValues: {
      notes: "",
    },
  });

  const reviewForm = useForm<z.infer<typeof reviewSchema>>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      status: "approved",
      feedback: "",
    },
  });

  const uploadSubmissionFile = async (file: File, notes: string): Promise<Submission> => {
    const uploadUrl = new URL("/api/submissions/upload", window.location.origin);
    uploadUrl.searchParams.set("taskId", String(taskId));
    uploadUrl.searchParams.set("filename", file.name);
    uploadUrl.searchParams.set("contentType", file.type || "application/pdf");
    uploadUrl.searchParams.set("notes", notes || "");

    const uploadResponse = await fetch(uploadUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/pdf",
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      const errorBody = await uploadResponse.json().catch(() => null) as { error?: string } | null;
      throw new Error(errorBody?.error || "Failed to upload submission file.");
    }

    return uploadResponse.json() as Promise<Submission>;
  };

  const getSubmissionFileHref = (fileUrl: string): string => {
    if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
      return fileUrl;
    }
    if (fileUrl.startsWith("/uploads/")) {
      return `/api/uploads${fileUrl.replace(/^\/uploads/, "")}`;
    }
    return fileUrl;
  };

  const getSubmissionFileName = (submissionId: number): string => {
    return `submission-${submissionId}.pdf`;
  };

  const downloadSubmissionFile = async (fileUrl: string, submissionId: number) => {
    try {
      const fileName = getSubmissionFileName(submissionId);

      if (fileUrl.startsWith("data:")) {
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast({ title: "Download started", description: "PDF is being downloaded." });
        return;
      }

      const fileHref = getSubmissionFileHref(fileUrl);
      const response = await fetch(fileHref);

      if (!response.ok) {
        throw new Error("Failed to download file");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(objectUrl);
      toast({ title: "Download started", description: "PDF is being downloaded." });
    } catch (error) {
      toast({
        title: "Download failed",
        description: "Could not download the attached PDF.",
        variant: "destructive",
      });
    }
  };

  const onSubmitTask = async (data: z.infer<typeof submitSchema>) => {
    if (!selectedFile) {
      toast({ title: "File Required", description: "Please attach a file before submitting.", variant: "destructive" });
      return;
    }

    try {
      setIsUploadingFile(true);
      await uploadSubmissionFile(selectedFile, data.notes || "");
      
      queryClient.invalidateQueries({ queryKey: taskSubmissionsQueryKey });
      queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) });
      setIsSubmitOpen(false);
      setSelectedFile(null);
      setFileInputKey((current) => current + 1);
      submitForm.reset();
      toast({ title: "Task Submitted", description: "Your work has been submitted for review." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to submit task.", variant: "destructive" });
    } finally {
      setIsUploadingFile(false);
    }
  };

  const onReviewTask = async (data: z.infer<typeof reviewSchema>) => {
    if (!reviewingSubmissionId) return;
    try {
      await reviewSubmission.mutateAsync({
        id: reviewingSubmissionId,
        data: {
          status: data.status,
          feedback: data.feedback,
        }
      });
      
      if (data.status === "approved") {
        await updateTask.mutateAsync({
          id: taskId,
          data: { status: UpdateTaskBodyStatus.reviewed }
        });
      } else {
        await updateTask.mutateAsync({
          id: taskId,
          data: { status: UpdateTaskBodyStatus.pending }
        });
      }
      
      queryClient.invalidateQueries({ queryKey: taskSubmissionsQueryKey });
      queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) });
      setReviewingSubmissionId(null);
      reviewForm.reset();
      toast({ title: "Review Submitted", description: "Your feedback has been recorded." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to submit review.", variant: "destructive" });
    }
  };

  if (taskLoading) {
    return (
      <AppLayout title="Task Details">
        <div className="space-y-6">
          <Skeleton className="h-8 w-32" />
          <Card>
            <CardHeader><Skeleton className="h-8 w-1/2" /></CardHeader>
            <CardContent><Skeleton className="h-32 w-full" /></CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (!task) {
    return (
      <AppLayout title="Task Details">
        <div className="text-center p-12">
          <h2 className="text-xl font-bold">Task not found</h2>
          <Button asChild className="mt-4"><Link href="/tasks">Back to Tasks</Link></Button>
        </div>
      </AppLayout>
    );
  }

  const getTaskStatusBadge = (status: string) => {
    switch (status) {
      case TaskStatus.pending: return <Badge variant="outline" className="bg-yellow-50 text-yellow-700">Pending</Badge>;
      case TaskStatus.submitted: return <Badge variant="outline" className="bg-blue-50 text-blue-700">Submitted</Badge>;
      case TaskStatus.reviewed: return <Badge variant="outline" className="bg-green-50 text-green-700">Reviewed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getSubStatusBadge = (status: string) => {
    switch (status) {
      case SubmissionStatus.pending: return <Badge variant="outline" className="bg-yellow-50 text-yellow-700"><Clock className="h-3 w-3 mr-1" /> Pending Review</Badge>;
      case SubmissionStatus.approved: return <Badge variant="outline" className="bg-green-50 text-green-700"><CheckCircle2 className="h-3 w-3 mr-1" /> Approved</Badge>;
      case SubmissionStatus.rejected: return <Badge variant="outline" className="bg-red-50 text-red-700"><XCircle className="h-3 w-3 mr-1" /> Needs Revision</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const taskSubmissions = submissions ?? [];

  const teamHasSupervisor = Boolean(task.team?.supervisorId);
  const canSubmit = user?.role === 'student' && task.status !== TaskStatus.reviewed && teamHasSupervisor;

  return (
    <AppLayout title="Task Details">
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4">
          <Button asChild variant="outline" size="icon">
            <Link href="/tasks"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <h2 className="text-2xl font-bold tracking-tight">Task Details</h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-2xl">{task.title}</CardTitle>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="secondary" className="capitalize">{task.phase}</Badge>
                      {getTaskStatusBadge(task.status)}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Description</h4>
                  <p className="text-sm whitespace-pre-wrap">{task.description || "No description provided."}</p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Deadline:</span>
                    <span className="font-medium">{task.deadline ? format(new Date(task.deadline), 'MMM d, yyyy h:mm a') : 'No deadline'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <CheckSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Created:</span>
                    <span className="font-medium">{format(new Date(task.createdAt), 'MMM d, yyyy')}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle>Submissions</CardTitle>
                  <CardDescription>History of work submitted for this task</CardDescription>
                </div>
                {canSubmit && (
                  <Dialog
                    open={isSubmitOpen}
                    onOpenChange={(open) => {
                      setIsSubmitOpen(open);
                      if (!open) {
                        setSelectedFile(null);
                        setFileInputKey((current) => current + 1);
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button size="sm">Submit Work</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Submit Task</DialogTitle>
                        <DialogDescription>
                          Upload your deliverable file and add notes for your supervisor.
                        </DialogDescription>
                      </DialogHeader>
                      <Form {...submitForm}>
                        <form onSubmit={submitForm.handleSubmit(onSubmitTask)} className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Attachment (PDF, DOCX, PPTX, ZIP)</label>
                            <Input
                              key={fileInputKey}
                              type="file"
                              accept=".pdf,application/pdf"
                              onChange={(event) => {
                                const file = event.target.files?.[0] ?? null;
                                setSelectedFile(file);
                              }}
                            />
                            <p className="text-xs text-muted-foreground">
                              {selectedFile ? `Selected: ${selectedFile.name}` : "Choose one file to submit."}
                            </p>
                          </div>
                          <FormField
                            control={submitForm.control}
                            name="notes"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Notes</FormLabel>
                                <FormControl>
                                  <Textarea placeholder="Explain what was done..." {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <DialogFooter>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setIsSubmitOpen(false);
                                setSelectedFile(null);
                                setFileInputKey((current) => current + 1);
                              }}
                            >
                              Cancel
                            </Button>
                            <Button type="submit" disabled={isUploadingFile || !selectedFile}>
                              {isUploadingFile ? "Submitting..." : "Submit"}
                            </Button>
                          </DialogFooter>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                )}
              </CardHeader>
              <CardContent>
                {user?.role === 'student' && !teamHasSupervisor ? (
                  <div className="mb-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Your team no longer has a supervisor, so this task cannot be submitted right now.
                  </div>
                ) : null}
                <div className="space-y-6">
                  {submissionsLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                    </div>
                  ) : taskSubmissions.length === 0 ? (
                    <div className="text-center p-8 border rounded-lg border-dashed">
                      <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No submissions yet.</p>
                    </div>
                  ) : (
                    taskSubmissions.map((sub) => (
                      <div key={sub.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-sm">{sub.submittedBy.name}</span>
                              <span className="text-xs text-muted-foreground">{format(new Date(sub.submittedAt), 'MMM d, h:mm a')}</span>
                            </div>
                            {getSubStatusBadge(sub.status)}
                          </div>
                          
                          {user?.role === 'supervisor' && sub.status === SubmissionStatus.pending && (
                            <Dialog 
                              open={reviewingSubmissionId === sub.id} 
                              onOpenChange={(open) => setReviewingSubmissionId(open ? sub.id : null)}
                            >
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline">Review</Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Review Submission</DialogTitle>
                                </DialogHeader>
                                <Form {...reviewForm}>
                                  <form onSubmit={reviewForm.handleSubmit(onReviewTask)} className="space-y-4">
                                    <FormField
                                      control={reviewForm.control}
                                      name="status"
                                      render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Decision</FormLabel>
                                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                              <SelectTrigger>
                                                <SelectValue placeholder="Select decision" />
                                              </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                              <SelectItem value="approved">Approve Task</SelectItem>
                                              <SelectItem value="rejected">Request Revision</SelectItem>
                                            </SelectContent>
                                          </Select>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                    <FormField
                                      control={reviewForm.control}
                                      name="feedback"
                                      render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Feedback</FormLabel>
                                          <FormControl>
                                            <Textarea placeholder="Provide constructive feedback..." {...field} />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                    <DialogFooter>
                                      <Button type="button" variant="outline" onClick={() => setReviewingSubmissionId(null)}>Cancel</Button>
                                      <Button type="submit" disabled={reviewSubmission.isPending}>
                                        {reviewSubmission.isPending ? "Saving..." : "Save Review"}
                                      </Button>
                                    </DialogFooter>
                                  </form>
                                </Form>
                              </DialogContent>
                            </Dialog>
                          )}
                        </div>
                        
                        {sub.notes && (
                          <div className="text-sm bg-muted/50 p-3 rounded-md">
                            <p className="text-xs font-medium text-muted-foreground mb-1">Student Notes:</p>
                            <p>{sub.notes}</p>
                          </div>
                        )}
                        
                        {typeof sub.fileUrl === "string" && sub.fileUrl.length > 0 && (
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              onClick={() => downloadSubmissionFile(sub.fileUrl!, sub.id)}
                            >
                              <Download className="h-4 w-4" />
                              Download PDF
                            </Button>
                          </div>
                        )}
                        
                        {sub.feedback && (
                          <div className={`text-sm p-3 rounded-md border ${sub.status === 'approved' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                            <p className="text-xs font-bold mb-1 flex items-center gap-1">
                              Supervisor Feedback:
                            </p>
                            <p>{sub.feedback}</p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Team Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Team Name</p>
                  <p className="text-sm font-medium">{task.team.name}</p>
                </div>
                {user?.role !== 'supervisor' && task.team.supervisor && (
                  <div className="pt-2">
                    <p className="text-xs text-muted-foreground">Supervisor</p>
                    <p className="text-sm font-medium">{task.team.supervisor.name}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}