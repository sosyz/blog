/**
 * A small D1Database stand-in over bun:sqlite with the real migrations
 * applied, for testing the queries in src/lib/server/db.ts. Covers what
 * db.ts uses: prepare().bind().first()/all()/run() and batch() (one
 * transaction, like D1).
 */
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dir, "..", "..", "migrations");
const READS = /^\s*(SELECT|WITH)\b/i;

type Result = {
  results: unknown[];
  success: true;
  meta: { changes: number };
};

class Statement {
  readonly #db: Database;
  readonly #sql: string;
  readonly #values: SQLQueryBindings[];

  constructor(db: Database, sql: string, values: SQLQueryBindings[] = []) {
    this.#db = db;
    this.#sql = sql;
    this.#values = values;
  }

  bind(...values: SQLQueryBindings[]) {
    return new Statement(this.#db, this.#sql, values);
  }

  execute(): Result {
    const query = this.#db.query(this.#sql);
    if (READS.test(this.#sql)) {
      return {
        results: query.all(...this.#values),
        success: true,
        meta: { changes: 0 },
      };
    }
    const { changes } = query.run(...this.#values);
    return { results: [], success: true, meta: { changes } };
  }

  first() {
    return Promise.resolve(this.execute().results.at(0) ?? null);
  }

  all() {
    return Promise.resolve(this.execute());
  }

  run() {
    return Promise.resolve(this.execute());
  }
}

export type TestDb = {
  sqlite: Database;
  d1: D1Database;
};

/** A fresh in-memory database with every migration applied. */
export const createTestDb = (): TestDb => {
  const sqlite = new Database(":memory:");
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    sqlite.run(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  const d1 = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    batch: (statements: Statement[]) =>
      Promise.resolve(
        sqlite.transaction(() =>
          statements.map((statement) => statement.execute())
        )()
      ),
  };
  return { sqlite, d1: d1 as unknown as D1Database };
};
