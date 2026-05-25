import { useEffect, useState } from "react";
import { useRegister, RegisterBodyRole } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, AlertCircle, User, Users, ClipboardList, Eye, EyeOff } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const registerSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    role: z.enum([RegisterBodyRole.student, RegisterBodyRole.supervisor, RegisterBodyRole.coordinator]),
    studentId: z.string().optional().nullable(),
    gender: z.enum(["Male", "Female"]).nullish(),
  })
  .superRefine((data, ctx) => {
    if (data.role === RegisterBodyRole.student) {
      const sid = data.studentId?.toString().trim();
      if (!sid) {
        ctx.addIssue({ path: ["studentId"], code: z.ZodIssueCode.custom, message: "Student ID is required for students" });
        return;
      }
      if (!/^[0-9A-Z]{6}$/i.test(sid)) {
        ctx.addIssue({ path: ["studentId"], code: z.ZodIssueCode.custom, message: "Student ID must be 6 characters (A-Z, 0-9)" });
      }
      if (!data.gender) {
        ctx.addIssue({ path: ["gender"], code: z.ZodIssueCode.custom, message: "Gender is required for students" });
      }
    }
  });

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function Register() {
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const registerMutation = useRegister();
  const [, setLocation] = useLocation();

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: RegisterBodyRole.student,
      studentId: "",
      gender: null,
    },
  });

  const selectedRole = form.watch("role");

  useEffect(() => {
    if (selectedRole !== RegisterBodyRole.student) {
      form.setValue("gender", null, { shouldDirty: true, shouldValidate: true });
    }
  }, [form, selectedRole]);

  const onSubmit = async (data: RegisterFormValues) => {
    setError(null);
    try {
      if (data.role === RegisterBodyRole.student) {
        const sid = data.studentId?.trim().toUpperCase();
        if (!sid) {
          setError("Student ID is required for students");
          return;
        }
        if (!/^[0-9A-Z]{6}$/.test(sid)) {
          setError("Student ID must be 6 characters (A-Z, 0-9)");
          return;
        }
        if (!data.gender) {
          setError("Gender is required for students");
          return;
        }
      }
      const payload = {
        ...data,
        studentId: data.studentId?.trim().toUpperCase() || null,
        gender: data.role === RegisterBodyRole.student ? data.gender : null,
      };
      await registerMutation.mutateAsync({ data: payload });
      setLocation("/login");
    } catch (err: any) {
      setError(err.message || "Failed to register. Please try again.");
    }
  };

  return (
    <div className="auth-shell min-h-screen w-full overflow-y-auto px-3 py-6 sm:px-4 sm:py-8">
      <section className="flex min-h-[calc(100vh-3rem)] w-full items-start justify-center sm:items-center">
        <div className="w-full max-w-2xl space-y-4 py-2">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Briefcase className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Create an Account</h1>
          </div>

          <Card className="border-primary/10">
            <CardHeader className="space-y-1 p-4 pb-2">
              <CardTitle className="text-lg text-center">Registration</CardTitle>
              <CardDescription className="text-center text-xs">
                Choose your role and complete your profile details
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              {error && (
                <Alert variant="destructive" className="mb-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">

                    <FormField
                      control={form.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <FormLabel>Select your role</FormLabel>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                              className="grid grid-cols-3 gap-2"
                            >
                              <FormItem>
                                <FormControl>
                                  <RadioGroupItem value={RegisterBodyRole.student} className="peer sr-only" />
                                </FormControl>
                                <FormLabel className="role-chip flex flex-col items-center justify-between rounded-md p-3 transition-all [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:shadow-md cursor-pointer">
                                  <User className="mb-1 h-5 w-5" />
                                  <span className="text-xs font-semibold">Student</span>
                                </FormLabel>
                              </FormItem>
                              <FormItem>
                                <FormControl>
                                  <RadioGroupItem value={RegisterBodyRole.supervisor} className="peer sr-only" />
                                </FormControl>
                                <FormLabel className="role-chip flex flex-col items-center justify-between rounded-md p-3 transition-all [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:shadow-md cursor-pointer">
                                  <Users className="mb-1 h-5 w-5" />
                                  <span className="text-xs font-semibold">Supervisor</span>
                                </FormLabel>
                              </FormItem>
                              <FormItem>
                                <FormControl>
                                  <RadioGroupItem value={RegisterBodyRole.coordinator} className="peer sr-only" />
                                </FormControl>
                                <FormLabel className="role-chip flex flex-col items-center justify-between rounded-md p-3 transition-all [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:shadow-md cursor-pointer">
                                  <ClipboardList className="mb-1 h-5 w-5" />
                                  <span className="text-xs font-semibold text-center">Coordinator</span>
                                </FormLabel>
                              </FormItem>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Student Name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {selectedRole === RegisterBodyRole.student && (
                      <FormField
                        control={form.control}
                        name="studentId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Student ID</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="e.g. A12B3C"
                                maxLength={6}
                                autoCapitalize="characters"
                                {...field}
                                value={field.value || ""}
                                onChange={(e) => {
                                  const alnum = e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
                                  field.onChange(alnum);
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    {selectedRole === RegisterBodyRole.student && (
                      <FormField
                        control={form.control}
                        name="gender"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Gender</FormLabel>
                            <FormControl>
                              <RadioGroup
                                onValueChange={field.onChange}
                                value={field.value ?? ""}
                                className="flex flex-row items-center gap-6"
                              >
                                <div className="flex items-center gap-2">
                                  <RadioGroupItem id="gender-male" value="Male" />
                                  <FormLabel htmlFor="gender-male" className="cursor-pointer font-normal capitalize text-foreground">
                                    male
                                  </FormLabel>
                                </div>
                                <div className="flex items-center gap-2">
                                  <RadioGroupItem id="gender-female" value="Female" />
                                  <FormLabel htmlFor="gender-female" className="cursor-pointer font-normal capitalize text-foreground">
                                    female
                                  </FormLabel>
                                </div>
                              </RadioGroup>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>University Email</FormLabel>
                          <FormControl>
                            <Input placeholder="name@just.edu.jo" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input type={showPassword ? "text" : "password"} placeholder="••••••••" className="pr-10" {...field} />
                              <button
                                type="button"
                                onClick={() => setShowPassword((v) => !v)}
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground"
                              >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full mt-3"
                      disabled={registerMutation.isPending}
                    >
                      {registerMutation.isPending ? "Creating account..." : "Create account"}
                    </Button>
                  </form>
                </Form>
            </CardContent>
            <CardFooter className="flex flex-col space-y-2 border-t px-4 py-3">
              <div className="text-sm text-center text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-primary font-medium hover:underline">
                  Sign in
                </Link>
              </div>
            </CardFooter>
          </Card>
        </div>
      </section>
    </div>
  );
}