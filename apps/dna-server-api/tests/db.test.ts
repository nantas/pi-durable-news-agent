import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lockFile } from "@dna/durable-agent";
import { openDb } from "../src/db/db.ts";
import { migrate } from "../src/db/migrate.ts";

const temp = () => mkdtempSync(join(tmpdir(), "dna-db-"));

test("opens in WAL mode", () => {
  const dir = temp();
  try {
    const db = openDb(join(dir, "dna.sqlite"));
    assert.equal((db.prepare("PRAGMA journal_mode").get() as any).journal_mode, "wal");
    assert.equal((db.prepare("PRAGMA foreign_keys").get() as any).foreign_keys, 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a reader reads while a writer holds an open transaction", () => {
  const dir = temp();
  try {
    const path = join(dir, "dna.sqlite");
    const writer = openDb(path);
    writer.exec("CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (1);");
    const reader = openDb(path);
    writer.exec("BEGIN IMMEDIATE; INSERT INTO t VALUES (2);");
    const seen = (reader.prepare("SELECT count(*) n FROM t").get() as any).n;
    assert.equal(seen, 1, "reader sees the last committed state without blocking");
    writer.exec("COMMIT");
    assert.equal((reader.prepare("SELECT count(*) n FROM t").get() as any).n, 2);
    writer.close();
    reader.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migrations apply once, in order", () => {
  const dir = temp();
  try {
    const migrations = join(dir, "migrations");
    mkdirSync(migrations);
    writeFileSync(join(migrations, "002_b.sql"), "ALTER TABLE a ADD COLUMN extra TEXT;");
    writeFileSync(join(migrations, "001_a.sql"), "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    const db = openDb(join(dir, "dna.sqlite"));
    assert.deepEqual(migrate(db, migrations), ["001_a.sql", "002_b.sql"]);
    assert.deepEqual(migrate(db, migrations), []);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a second live owner is refused by the PID lock", async () => {
  const dir = temp();
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
  try {
    const path = join(dir, "dna.sqlite.lock");
    writeFileSync(path, String(other.pid));
    assert.throws(() => lockFile(path), /already owned by process/);
    other.kill();
    await new Promise((r) => other.once("exit", r));
    const unlock = lockFile(path);
    unlock();
  } finally {
    other.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a source added to config later reaches an existing database once, and a removed one stays removed", async () => {
  const { openStore } = await import("../src/db/store.ts");
  const dir = temp();
  const config = join(dir, "config");
  mkdirSync(config);
  const write = (n: number) =>
    writeFileSync(
      join(config, "sources.json"),
      JSON.stringify({
        sources: Array.from({ length: n }, (_, i) => ({
          kind: "rss",
          name: `S${i}`,
          url: `https://s${i}.dev/feed`,
        })),
      }),
    );
  writeFileSync(
    join(config, "keywords.json"),
    JSON.stringify({ topic: [], hype: [], facts: [], signal: [] }),
  );
  try {
    write(2);
    let store = openStore(join(dir, "data"), config);
    assert.equal(store.sources.list().length, 2);
    store.sources.remove(store.sources.list()[0].id);
    store.close();
    write(3);
    store = openStore(join(dir, "data"), config);
    assert.deepEqual(
      store.sources.list().map((s) => s.name),
      ["S1", "S2"],
    );
    assert.ok(store.sources.list().every((s) => s.origin === "config"));
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("source kind migration preserves referenced source ids and restores FK enforcement", () => {
  const dir = temp();
  const db = openDb(join(dir, "dna.sqlite"));
  try {
    db.exec(readFileSync(join(import.meta.dirname, "../src/db/migrations/001_schema.sql"), "utf8"));
    db.exec("CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run("001_schema.sql", "fixture");
    db.exec(
      "INSERT INTO sources(id,kind,name,url,created_at) VALUES (1,'rss','Existing','https://example.com/feed','fixture')",
    );
    db.exec(
      "INSERT INTO items(source_id,url,url_hash,title,created_at,updated_at) VALUES (1,'https://example.com/item','fixture','Existing material','fixture','fixture')",
    );
    migrate(db);
    assert.equal(db.prepare("SELECT source_id FROM items").get()?.source_id, 1);
    assert.equal(db.prepare("SELECT name FROM sources WHERE id=1").get()?.name, "Existing");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
