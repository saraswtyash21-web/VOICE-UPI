import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export function openDatabase(path = process.env.DATABASE_PATH || './data/voiceguide.sqlite') {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS recipients (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, upi_id TEXT NOT NULL UNIQUE,
      relation TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY, recipient_id TEXT, recipient_name TEXT NOT NULL,
      upi_id TEXT NOT NULL, amount_paise INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
      reference TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
      FOREIGN KEY (recipient_id) REFERENCES recipients(id) ON DELETE SET NULL
    );
  `);
  const count = db.prepare('SELECT COUNT(*) AS n FROM recipients').get().n;
  if (!count) {
    const insert = db.prepare('INSERT INTO recipients (id,name,upi_id,relation,created_at) VALUES (?,?,?,?,?)');
    const now = new Date().toISOString();
    insert.run('demo-anita', 'Anita Sharma', 'anita.sharma@demo', 'Daughter', now);
    insert.run('demo-rajesh', 'Rajesh Kumar', 'rajesh.kumar@demo', 'Neighbour', now);
    insert.run('demo-meena', 'Meena Devi', 'meena.devi@demo', 'Friend', now);
  }
  return db;
}
