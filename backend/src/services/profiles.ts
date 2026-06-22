import { db, usersTable, studentProfilesTable, teamsTable, teamMembersTable } from "@workspace/db";
import { eq } from "@workspace/db";

// ============ Formatting ============

export function formatProfile(profile: typeof studentProfilesTable.$inferSelect, user: typeof usersTable.$inferSelect) {
  return {
    id: profile.id,
    userId: profile.userId,
    studentId: profile.studentId,
    gpa: profile.gpa,
    skills: profile.skills,
    interests: profile.interests,
    description: profile.description,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt },
  };
}

// ============ Profile Queries ============

/**
 * Get current user's profile
 */
export async function getMyProfile(userId: number) {
  const [profile] = await db.select().from(studentProfilesTable).where(eq(studentProfilesTable.userId, userId));
  if (!profile) {
    throw new Error("Profile not found");
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return formatProfile(profile, user);
}

/**
 * Update current user's profile
 */
export async function updateMyProfile(userId: number, data: { gpa?: number; skills?: string; interests?: string; description?: string }) {
  const { gpa, skills, interests, description } = data;
  let [profile] = await db.select().from(studentProfilesTable).where(eq(studentProfilesTable.userId, userId));
  if (!profile) {
    [profile] = await db.insert(studentProfilesTable).values({ userId, gpa, skills, interests, description }).returning();
  } else {
    [profile] = await db.update(studentProfilesTable)
      .set({ gpa, skills, interests, description })
      .where(eq(studentProfilesTable.userId, userId))
      .returning();
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return formatProfile(profile, user);
}

/**
 * Get profile by user ID
 */
export async function getProfileByUserId(userId: number) {
  const [profile] = await db.select().from(studentProfilesTable).where(eq(studentProfilesTable.userId, userId));
  if (!profile) {
    throw new Error("Profile not found");
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return formatProfile(profile, user);
}

/**
 * Get student's team with leader and supervisor
 */
export async function getStudentTeam(userId: number) {
  const [membership] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId));
  if (!membership) {
    throw new Error("Team not found for this student");
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId));
  if (!team) {
    throw new Error("Team not found");
  }

  const [leader] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, team.leaderId));

  let supervisor = null;
  if (team.supervisorId) {
    const [s] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, officeHours: usersTable.officeHours, createdAt: usersTable.createdAt })
      .from(usersTable)
      .where(eq(usersTable.id, team.supervisorId));
    supervisor = s || null;
  }

  return { ...team, leader, supervisor };
}

/**
 * Get all student profiles for coordinator with optional supervisor filter
 */
export async function getCoordinatorStudentProfiles(supervisorFilter?: number) {
  const userResults = await db.select().from(usersTable).where(eq(usersTable.role, "student"));
  const profileResults = await db.select().from(studentProfilesTable);
  const teams = await db.select().from(teamsTable);
  const members = await db.select().from(teamMembersTable);
  const supervisors = await db.select().from(usersTable).where(eq(usersTable.role, "supervisor"));

  const profileMap = new Map(profileResults.map((p) => [p.userId, p]));
  const supervisorMap = new Map(supervisors.map((sup) => [sup.id, sup]));
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const membershipMap = new Map<number, typeof teamMembersTable.$inferSelect>();

  for (const membership of members) {
    if (!membershipMap.has(membership.userId)) {
      membershipMap.set(membership.userId, membership);
    }
  }

  const results = userResults.map((user) => {
    const profile = profileMap.get(user.id);
    const membership = membershipMap.get(user.id);
    const team = membership ? teamMap.get(membership.teamId) : null;
    const supervisor = team?.supervisorId ? supervisorMap.get(team.supervisorId) : null;

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      studentId: profile?.studentId ?? null,
      teamId: team?.id ?? null,
      teamName: team?.name ?? null,
      teamStatus: team?.status ?? null,
      projectTitle: team?.projectTitle ?? null,
      supervisorId: supervisor?.id ?? null,
      supervisorName: supervisor?.name ?? null,
    };
  });

  return supervisorFilter ? results.filter((row) => row.supervisorId === supervisorFilter) : results;
}

/**
 * Get all student profiles with optional filtering by skills, GPA, and search term
 */
export async function getAllStudentProfiles(options: { skills?: string; minGpa?: number; search?: string } = {}) {
  const userResults = await db.select().from(usersTable).where(eq(usersTable.role, "student"));
  const profileResults = await db.select().from(studentProfilesTable);

  const userMap = new Map(userResults.map(u => [u.id, u]));
  const profileMap = new Map(profileResults.map(p => [p.userId, p]));

  // Ensure all students have profiles
  const missingStudentUsers = userResults.filter((u) => !profileMap.has(u.id));
  if (missingStudentUsers.length > 0) {
    const createdProfiles = await db
      .insert(studentProfilesTable)
      .values(missingStudentUsers.map((u) => ({ userId: u.id })))
      .returning();

    for (const profile of createdProfiles) {
      profileMap.set(profile.userId, profile);
    }
  }

  let results = userResults
    .map(u => {
      const profile = profileMap.get(u.id);
      if (!profile) return null;
      const user = userMap.get(u.id);
      if (!user) return null;
      return formatProfile(profile, user);
    })
    .filter(Boolean) as ReturnType<typeof formatProfile>[];

  // Apply filters
  if (options.skills) {
    const skillsLower = options.skills.toLowerCase();
    results = results.filter(r => r.skills?.toLowerCase().includes(skillsLower));
  }
  if (options.minGpa) {
    results = results.filter(r => r.gpa != null && r.gpa >= options.minGpa!);
  }
  if (options.search) {
    const searchLower = options.search.toLowerCase();
    results = results.filter(r =>
      r.user.name.toLowerCase().includes(searchLower) ||
      (r.studentId ?? "").toString().toLowerCase().includes(searchLower)
    );
  }

  return results;
}
