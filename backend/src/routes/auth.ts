import { Router } from "express";
import type { IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, studentProfilesTable } from "@workspace/db";
import { eq } from "@workspace/db";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/session";
import { logActivity } from "../lib/notify";

const router: IRouter = Router();

function formatUser(user: typeof usersTable.$inferSelect) {
  return { id: user.id, name: user.name, email: user.email, studentId: user.studentId ?? null, role: user.role, officeHours: user.officeHours ?? null, createdAt: user.createdAt };
}

function generateStudentId(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, email, password, role, studentId } = parsed.data;

  if (role === "student" && studentId) {
    // Check if this student ID is already registered
    // Validate studentId format (6 uppercase alphanumeric)
    const normalized = typeof studentId === "string" ? studentId.trim().toUpperCase() : studentId;
    if (!/^[0-9A-Z]{6}$/.test(normalized)) {
      res.status(400).json({ error: "Student ID must be 6 characters (A-Z, 0-9)" });
      return;
    }

    const [existing] = await db.select().from(studentProfilesTable).where(eq(studentProfilesTable.studentId, normalized));
    if (existing) {
      res.status(400).json({ error: "This student ID is already registered" });
      return;
    }
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  // include studentId on users table for student role
  const userInsert: any = { name, email, passwordHash, role };
  let finalStudentId: string | null = null;
  if (role === "student") {
    finalStudentId = (studentId && studentId.trim()) ? studentId.trim().toUpperCase() : generateStudentId();
    userInsert.studentId = finalStudentId;
  } else {
    userInsert.studentId = null;
  }

  let user: any;
  try {
    [user] = await db.insert(usersTable).values(userInsert).returning();
  } catch (err: any) {
    if (err && (err.code === 11000 || (typeof err.message === "string" && (err.message.includes("E11000") || err.message.toLowerCase().includes("duplicate key"))))) {
      res.status(409).json({ error: "This student ID is already registered" });
      return;
    }
    throw err;
  }

  if (role === "student") {
    await db.insert(studentProfilesTable).values({
      userId: user.id,
      studentId: finalStudentId,
    });
  }

  await logActivity("register", `${name} registered as ${role}`, user.id);

  res.status(201).json({
    user: formatUser(user),
    message: "Registered successfully",
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  req.session.userId = user.id;

  res.json({
    user: formatUser(user),
    message: "Logged in successfully",
  });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  req.session.destroy(() => {
    res.json({ message: "Logged out" });
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!dbUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(dbUser));
});

router.put("/auth/me", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "supervisor") {
    res.status(403).json({ error: "Only supervisors can update office hours" });
    return;
  }

  const { officeHours } = req.body as { officeHours?: string | null };
  let normalizedOfficeHours: string | null = null;
  if (typeof officeHours === "string") {
    const lines = officeHours.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const invalidLines = lines.filter((value) => Number.isNaN(new Date(value).getTime()));
    if (invalidLines.length > 0) {
      res.status(400).json({ error: "Office hours must contain valid date-time values" });
      return;
    }
    normalizedOfficeHours = lines.map((value) => new Date(value).toISOString()).join("\n");
  }

  const [updated] = await db.update(usersTable)
    .set({ officeHours: normalizedOfficeHours })
    .where(eq(usersTable.id, req.user!.id))
    .returning();

  res.json(formatUser(updated));
});

export default router;

