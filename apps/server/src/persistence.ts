import Database from "better-sqlite3";
import type { GameState } from "@among-us/shared";
import type { Command } from "./engine";

/** Append-only command journal plus a single JSON snapshot of the latest state. */
export class Persistence {
  private readonly db: Database.Database;
  private readonly insertJournal: Database.Statement;
  private readonly upsertSnapshot: Database.Statement;
  private readonly saveTx: (command: Command, state: GameState, at: number) => void;

  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        game_id TEXT NOT NULL,
        type TEXT NOT NULL,
        command TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshot (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        at INTEGER NOT NULL,
        state TEXT NOT NULL
      );
    `);
    this.insertJournal = this.db.prepare("INSERT INTO journal (at, game_id, type, command) VALUES (?, ?, ?, ?)");
    this.upsertSnapshot = this.db.prepare(
      "INSERT INTO snapshot (id, at, state) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, state = excluded.state",
    );
    this.saveTx = this.db.transaction((command: Command, state: GameState, at: number) => {
      this.insertJournal.run(at, state.gameId, command.type, JSON.stringify(command));
      this.upsertSnapshot.run(at, JSON.stringify(state));
    });
  }

  /** Journals an accepted command and snapshots the resulting state atomically. */
  save(command: Command, state: GameState, at: number): void {
    this.saveTx(command, state, at);
  }

  saveSnapshot(state: GameState, at: number): void {
    this.upsertSnapshot.run(at, JSON.stringify(state));
  }

  loadSnapshot(): GameState | null {
    const row = this.db.prepare("SELECT state FROM snapshot WHERE id = 1").get() as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as GameState) : null;
  }

  journal(limit = 100): { at: number; type: string; command: Command }[] {
    const rows = this.db
      .prepare("SELECT at, type, command FROM journal ORDER BY id DESC LIMIT ?")
      .all(limit) as { at: number; type: string; command: string }[];
    return rows.reverse().map((r) => ({ at: r.at, type: r.type, command: JSON.parse(r.command) as Command }));
  }

  close(): void {
    this.db.close();
  }
}
