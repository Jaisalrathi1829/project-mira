import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
  `)
  return db
}

const depth = new WeakMap<Db, number>()

/** Runs `fn` atomically. Nested calls become savepoints, so an inner failure rolls back only its own work. */
export function transaction<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0
  const sp = `sp_${level}`
  db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`)
  depth.set(db, level + 1)
  try {
    const result = fn()
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${sp}`)
    return result
  } catch (err) {
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
    throw err
  } finally {
    depth.set(db, level)
  }
}
