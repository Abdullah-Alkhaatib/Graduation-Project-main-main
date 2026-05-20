import { MongoClient } from "mongodb";
import * as schema from "./schema";
import type { ColumnRef } from "./schema/_core";

export * from "./schema";

type Primitive = string | number | boolean | null | Date | undefined;
type Row = Record<string, Primitive>;
type AnyTable = { tableName: string; [key: string]: unknown };

type Condition =
  | { type: "eq"; column: ColumnRef<unknown>; value: unknown }
  | { type: "gte"; column: ColumnRef<unknown>; value: unknown }
  | { type: "ilike"; column: ColumnRef<unknown>; pattern: string }
  | { type: "and"; conditions: Condition[] }
  | { type: "or"; conditions: Condition[] };

type SortSpec = { type: "desc"; column: ColumnRef<unknown> };
type SqlCount = { type: "count" };

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
  throw new Error("MONGO_URL must be set. Did you forget to configure MongoDB?");
}

const dbName = (() => {
  try {
    const url = new URL(mongoUrl);
    const fromPath = url.pathname.replace(/^\//, "").trim();
    return fromPath.length > 0 ? fromPath : "project";
  } catch {
    return "project";
  }
})();

const client = new MongoClient(mongoUrl);
const dbPromise = client.connect().then((c) => c.db(dbName));

// Ensure unique indexes for studentId (only when field is present)
dbPromise.then(async (database) => {
  try {
    await database.collection("users").createIndex(
      { studentId: 1 },
      { unique: true, partialFilterExpression: { studentId: { $type: "string" } } },
    );

    await database.collection("student_profiles").createIndex(
      { studentId: 1 },
      { unique: true, partialFilterExpression: { studentId: { $type: "string" } } },
    );
  } catch (err) {
    // Log and continue; index creation may fail if already exists or permissions differ
    // Keep server running because indexes are not critical for startup
    // eslint-disable-next-line no-console
    console.error("Error creating indexes for studentId:", err);
  }
});

async function getCollection(table: AnyTable) {
  const database = await dbPromise;
  return database.collection<Row>(table.tableName);
}

async function nextId(tableName: string) {
  const database = await dbPromise;
  const result = await database.collection<{ tableName: string; seq: number }>("__counters").findOneAndUpdate(
    { tableName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );

  return result?.seq ?? 1;
}

function toRegexPattern(pattern: string) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function matchCondition(row: Row, condition: Condition): boolean {
  switch (condition.type) {
    case "eq":
      return row[condition.column.key] === (condition.value as Primitive);
    case "gte": {
      const left = row[condition.column.key];
      const right = condition.value as Primitive;
      if (left == null || right == null) {
        return false;
      }
      return (left as number | string | Date) >= (right as number | string | Date);
    }
    case "ilike": {
      const value = row[condition.column.key];
      if (typeof value !== "string") {
        return false;
      }
      return toRegexPattern(condition.pattern).test(value);
    }
    case "and":
      return condition.conditions.every((child) => matchCondition(row, child));
    case "or":
      return condition.conditions.some((child) => matchCondition(row, child));
    default:
      return false;
  }
}

function normalizeRow(row: Row) {
  const normalized = { ...row };
  delete (normalized as Row & { _id?: unknown })._id;
  return normalized;
}

function applyDefaults(tableName: string, row: Row): Row {
  const now = new Date();
  switch (tableName) {
    case "users":
      return { officeHours: null, createdAt: now, ...row };
    case "teams":
      return { status: "forming", currentPhase: null, createdAt: now, ...row };
    case "team_members":
      return { role: "member", joinedAt: now, ...row };
    case "student_profiles":
      return { gpa: null, skills: null, interests: null, description: null, updatedAt: now, ...row };
    case "invitations":
      return { status: "pending", createdAt: now, ...row };
    case "supervisor_requests":
      return { status: "pending", createdAt: now, ...row };
    case "project_phases":
      return { status: "in_progress", startedAt: now, completedAt: null, ...row };
    case "tasks":
      return { description: null, deadline: null, supervisorId: null, status: "pending", createdAt: now, ...row };
    case "submissions":
      return { fileUrl: null, notes: null, status: "pending", feedback: null, submittedAt: now, ...row };
    case "meetings":
      return { status: "pending", notes: null, createdAt: now, ...row };
    case "notifications":
      return { isRead: false, relatedId: null, relatedType: null, createdAt: now, ...row };
    case "activity_logs":
      return { userId: null, teamId: null, createdAt: now, ...row };
    case "team_announcements":
      return { title: null, description: null, leaderId: null, teamId: null, createdAt: now, ...row };
    default:
      return { ...row };
  }
}

class SelectBuilder implements PromiseLike<any[]> {
  private condition: Condition | null = null;
  private sort: SortSpec | null = null;
  private max: number | null = null;

  constructor(
    private readonly table: AnyTable,
    private readonly fields?: Record<string, ColumnRef<unknown> | SqlCount>,
  ) {}

  where(condition: Condition) {
    this.condition = condition;
    return this;
  }

  orderBy(sort: SortSpec) {
    this.sort = sort;
    return this;
  }

  limit(max: number) {
    this.max = max;
    return this;
  }

  async exec(): Promise<any[]> {
    const collection = await getCollection(this.table as AnyTable);
    const docs = await collection.find({}).toArray();

    let rows = docs.map(normalizeRow);

    if (this.condition) {
      rows = rows.filter((row) => matchCondition(row, this.condition!));
    }

    if (this.sort) {
      const key = this.sort.column.key;
      rows.sort((a, b) => {
        const left = a[key] as number | string | Date | undefined;
        const right = b[key] as number | string | Date | undefined;
        if (left == null && right == null) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        return left < right ? 1 : left > right ? -1 : 0;
      });
    }

    if (this.max != null) {
      rows = rows.slice(0, this.max);
    }

    if (this.fields) {
      const values = Object.values(this.fields);
      const hasCount = values.some((value) => (value as SqlCount).type === "count");
      if (hasCount) {
        return [{ count: rows.length }];
      }

      return rows.map((row) => {
        const projected: Row = {};
        for (const [alias, column] of Object.entries(this.fields!)) {
          const col = column as ColumnRef<unknown>;
          projected[alias] = row[col.key];
        }
        return projected;
      });
    }

    return rows;
  }

  then<TResult1 = any[], TResult2 = never>(
    onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class InsertBuilder implements PromiseLike<any[]> {
  private payload: Array<Record<string, unknown>> = [];

  constructor(private readonly table: AnyTable) {}

  values(value: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.payload = Array.isArray(value) ? value : [value];
    return this;
  }

  async exec(): Promise<any[]> {
    const collection = await getCollection(this.table as AnyTable);
    const records = await Promise.all(
      this.payload.map(async (item) => {
        const id = await nextId(this.table.tableName);
        return applyDefaults(this.table.tableName, { id, ...(item as Row) });
      }),
    );
    if (records.length > 0) {
      await collection.insertMany(records as Row[]);
    }
    return records as any[];
  }

  returning() {
    return this.exec();
  }

  then<TResult1 = any[], TResult2 = never>(
    onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class UpdateBuilder implements PromiseLike<any[]> {
  private payload: Record<string, unknown> = {};
  private condition: Condition | null = null;

  constructor(private readonly table: AnyTable) {}

  set(value: Record<string, unknown>) {
    this.payload = value;
    return this;
  }

  where(condition: Condition) {
    this.condition = condition;
    return this;
  }

  async exec(): Promise<any[]> {
    const collection = await getCollection(this.table as AnyTable);
    const docs = await collection.find({}).toArray();
    const rows = docs.map(normalizeRow).filter((row) => (this.condition ? matchCondition(row, this.condition) : true));
    const cleanPayload = Object.fromEntries(
      Object.entries(this.payload as Row).filter(([, value]) => value !== undefined),
    ) as Row;

    if (this.table.tableName === "student_profiles") {
      cleanPayload.updatedAt = new Date();
    }

    for (const row of rows) {
      await collection.updateOne({ id: row.id } as Row, { $set: cleanPayload });
    }

    const ids = rows.map((row) => row.id) as number[];
    if (ids.length === 0) {
      return [];
    }

    return (await collection.find({ id: { $in: ids } }).toArray()).map(normalizeRow);
  }

  returning() {
    return this.exec();
  }

  then<TResult1 = any[], TResult2 = never>(
    onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class DeleteBuilder implements PromiseLike<void> {
  private condition: Condition | null = null;

  constructor(private readonly table: AnyTable) {}

  where(condition: Condition) {
    this.condition = condition;
    return this.exec();
  }

  async exec(): Promise<void> {
    const collection = await getCollection(this.table as AnyTable);
    if (!this.condition) {
      return;
    }
    const docs = await collection.find({}).toArray();
    const ids = docs.map(normalizeRow).filter((row) => matchCondition(row, this.condition!)).map((row) => row.id);
    if (ids.length > 0) {
      await collection.deleteMany({ id: { $in: ids as number[] } } as never);
    }
  }

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export const db = {
  select(fields?: Record<string, ColumnRef<unknown> | SqlCount>) {
    return {
      from(table: AnyTable) {
        return new SelectBuilder(table, fields);
      },
    };
  },
  insert(table: AnyTable) {
    return new InsertBuilder(table);
  },
  update(table: AnyTable) {
    return new UpdateBuilder(table);
  },
  delete(table: AnyTable) {
    return new DeleteBuilder(table);
  },
};

export function eq(column: ColumnRef<unknown>, value: unknown): Condition {
  return { type: "eq", column, value };
}

export function gte(column: ColumnRef<unknown>, value: unknown): Condition {
  return { type: "gte", column, value };
}

export function ilike(column: ColumnRef<unknown>, pattern: string): Condition {
  return { type: "ilike", column, pattern };
}

export function and(...conditions: Condition[]): Condition {
  return { type: "and", conditions };
}

export function or(...conditions: Condition[]): Condition {
  return { type: "or", conditions };
}

export function desc(column: ColumnRef<unknown>): SortSpec {
  return { type: "desc", column };
}

export function sql<T>(_parts: TemplateStringsArray, ..._values: unknown[]): SqlCount {
  return { type: "count" };
}

export const pool = null;
