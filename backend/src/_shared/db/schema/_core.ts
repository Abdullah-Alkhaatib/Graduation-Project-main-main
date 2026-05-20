export type ColumnRef<T> = {
  readonly __kind: "column";
  readonly tableName: string;
  readonly key: string;
  readonly _type?: T;
};

export type TableDef<T extends Record<string, unknown>> = {
  readonly tableName: string;
  readonly $inferSelect: T;
} & {
  readonly [K in keyof T]: ColumnRef<T[K]>;
};

export function defineTable<T extends Record<string, unknown>>(
  tableName: string,
  keys: ReadonlyArray<keyof T>,
): TableDef<T> {
  const table: Record<string, unknown> = {
    tableName,
  };

  for (const key of keys) {
    table[String(key)] = {
      __kind: "column",
      tableName,
      key: String(key),
    } as ColumnRef<unknown>;
  }

  return table as TableDef<T>;
}