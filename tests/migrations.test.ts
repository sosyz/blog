// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", "migrations");
const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name);

const logInsert = `INSERT INTO moderation_log (item_type, item_id, decision, actor, note, created_at)
  VALUES ('sticker', 's1', ?, 'admin:test', NULL, 1)`;

describe("migrations", () => {
  test("apply in order on an empty database", () => {
    const db = new Database(":memory:");
    for (const file of files) {
      db.run(readFileSync(join(DIR, file), "utf8"));
    }
    expect(columns(db, "stickers")).toContain("edit_token_hash");
    expect(columns(db, "stickers")).toContain("updated_at");
    expect(columns(db, "moderation_log")).toContain("ip_hash");
    db.query(logInsert).run("move");
    expect(() => db.query(logInsert).run("teleport")).toThrow();
    expect(columns(db, "comments")).toContain("user_id");
    expect(columns(db, "stickers")).toContain("user_id");
    expect(columns(db, "users")).toEqual([
      "id",
      "github_id",
      "login",
      "name",
      "avatar_url",
      "html_url",
      "created_at",
      "updated_at",
    ]);
    expect(columns(db, "sessions")).toEqual([
      "id",
      "user_id",
      "created_at",
      "expires_at",
      "last_seen_at",
    ]);
    expect(columns(db, "hidden_builtins")).toEqual([
      "key",
      "hidden_at",
      "hidden_by",
    ]);
  });

  test("one user per GitHub id, sessions go with their user", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys = ON");
    for (const file of files) {
      db.run(readFileSync(join(DIR, file), "utf8"));
    }
    const addUser = db.query(
      `INSERT INTO users (id, github_id, login, name, avatar_url, html_url, created_at, updated_at)
       VALUES (?, ?, 'someone', NULL, 'https://avatars.githubusercontent.com/u/1', 'https://github.com/someone', 1, 1)`
    );
    addUser.run("u1", 1);
    expect(() => addUser.run("u2", 1)).toThrow();
    db.query(
      "INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES ('s1', 'u1', 1, 2, 1)"
    ).run();
    db.query("DELETE FROM users WHERE id = 'u1'").run();
    const left = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sessions")
      .get();
    expect(left?.n).toBe(0);
  });

  test("moderation_log takes moves, not unknown decisions", () => {
    const db = new Database(":memory:");
    for (const file of files) {
      db.run(readFileSync(join(DIR, file), "utf8"));
    }
    db.query(logInsert).run("approve");
    db.query(logInsert).run("move");
    expect(() => db.query(logInsert).run("teleport")).toThrow();
    const rows = db
      .query<{ id: number; decision: string }, []>(
        "SELECT id, decision FROM moderation_log ORDER BY id"
      )
      .all();
    expect(rows).toEqual([
      { id: 1, decision: "approve" },
      { id: 2, decision: "move" },
    ]);
  });
});
