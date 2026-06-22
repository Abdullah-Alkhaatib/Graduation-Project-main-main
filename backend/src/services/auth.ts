import bcrypt from "bcryptjs";
import { db, usersTable, studentProfilesTable } from "@workspace/db";
import { eq } from "@workspace/db";
import type { RegisterBody, LoginBody } from "@workspace/api-zod";
import { logActivity } from "../lib/notify";

export type FormattedUser = {
  id: number;
  name: string;
  email: string;
  studentId: string | null;
  gender: string | null;
  role: string;
  officeHours: string | null;
  createdAt: Date;
};

export type RegisterData = {
  name: string;
  email: string;
  password: string;
  role: string;
  studentId?: string;
  gender?: string;
};

/**
 * Format user data for API response
 */
export function formatUser(user: typeof usersTable.$inferSelect): FormattedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    studentId: user.studentId ?? null,
    gender: user.gender ?? null,
    role: user.role,
    officeHours: user.officeHours ?? null,
    createdAt: user.createdAt,
  };
}

/**
 * Generate a random 6-character student ID (A-Z, 0-9)
 */
export function generateStudentId(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Validate student ID format: 6 uppercase alphanumeric characters
 */
export function validateStudentId(studentId: string): { valid: boolean; error?: string } {
  const normalized = typeof studentId === "string" ? studentId.trim().toUpperCase() : studentId;
  if (!/^[0-9A-Z]{6}$/.test(normalized)) {
    return { valid: false, error: "Student ID must be 6 characters (A-Z, 0-9)" };
  }
  return { valid: true };
}

/**
 * Check if a student ID is already registered
 */
export async function isStudentIdRegistered(studentId: string): Promise<boolean> {
  const [existing] = await db.select().from(studentProfilesTable).where(eq(studentProfilesTable.studentId, studentId));
  return !!existing;
}

/**
 * Check if an email is already registered
 */
export async function isEmailRegistered(email: string): Promise<boolean> {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  return !!existing;
}

/**
 * Register a new user
 */
export async function registerUser(data: RegisterData): Promise<{ user: FormattedUser; message: string }> {
  const { name, email, password, role, studentId, gender } = data;

  // Validate student requirements
  if (role === "student") {
    if (!gender) {
      throw new Error("Gender is required for students");
    }

    if (studentId) {
      const validation = validateStudentId(studentId);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const normalized = studentId.trim().toUpperCase();
      if (await isStudentIdRegistered(normalized)) {
        throw new Error("This student ID is already registered");
      }
    }
  }

  // Check if email exists
  if (await isEmailRegistered(email)) {
    throw new Error("Email already registered");
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // Prepare user data
  const userInsert: any = { name, email, passwordHash, role, gender: null };
  let finalStudentId: string | null = null;

  if (role === "student") {
    finalStudentId = studentId ? studentId.trim().toUpperCase() : generateStudentId();
    userInsert.studentId = finalStudentId;
    userInsert.gender = gender;
  } else {
    userInsert.studentId = null;
  }

  // Create user
  let user: any;
  try {
    [user] = await db.insert(usersTable).values(userInsert).returning();
  } catch (err: any) {
    if (err && (err.code === 11000 || (typeof err.message === "string" && (err.message.includes("E11000") || err.message.toLowerCase().includes("duplicate key"))))) {
      throw new Error("This student ID is already registered");
    }
    throw err;
  }

  // Create student profile if student
  if (role === "student" && finalStudentId) {
    await db.insert(studentProfilesTable).values({
      userId: user.id,
      studentId: finalStudentId,
    });
  }

  // Log activity
  await logActivity("register", `${name} registered as ${role}`, user.id);

  return {
    user: formatUser(user),
    message: "Registered successfully",
  };
}

/**
 * Authenticate user with email and password
 */
export async function loginUser(email: string, password: string): Promise<{ user: FormattedUser; message: string; userId: number }> {
  // Find user by email
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    throw new Error("Invalid email or password");
  }

  // Verify password
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new Error("Invalid email or password");
  }

  return {
    user: formatUser(user),
    message: "Logged in successfully",
    userId: user.id,
  };
}

/**
 * Get user by ID
 */
export async function getUserById(userId: number): Promise<FormattedUser | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user ? formatUser(user) : null;
}

/**
 * Update supervisor office hours
 */
export async function updateOfficeHours(userId: number, officeHours: string | null): Promise<FormattedUser> {
  const [updated] = await db.update(usersTable).set({ officeHours }).where(eq(usersTable.id, userId)).returning();
  return formatUser(updated);
}
