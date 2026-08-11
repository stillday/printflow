import { invoke } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';

/**
 * Must match `DB_FILE_NAME` in `src-tauri/src/lib.rs`. The plugin resolves the
 * relative path against the OS app-config directory and runs the Rust-side
 * migrations on first load.
 */
export const DB_URL = 'sqlite:printflow.db';

let connection: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
	if (!connection) {
		connection = Database.load(DB_URL).catch((error) => {
			// Don't cache a failed connection — a retry should be able to succeed.
			connection = null;
			throw error;
		});
	}
	return connection;
}

/** Releases the pool so the database file can be copied or replaced safely. */
export async function closeDb(): Promise<void> {
	if (!connection) return;
	const db = await connection.catch(() => null);
	connection = null;
	await db?.close();
}

export type SqlParam = string | number | boolean | null;

export interface TxStatement {
	sql: string;
	params?: SqlParam[];
}

export interface TxResult {
	rowsAffected: number;
	lastInsertId: number;
}

/**
 * Runs statements in a single SQLite transaction on the Rust side.
 *
 * `plugin-sql` hands out pooled connections, so `BEGIN`/`COMMIT` issued as
 * separate `execute` calls could straddle two connections. Anything that must
 * not half-apply — stock deduction plus part counters, above all — goes
 * through here.
 */
export async function transaction(statements: TxStatement[]): Promise<TxResult[]> {
	if (statements.length === 0) return [];
	// `db_transaction` looks the pool up in the plugin's own `DbInstances` map.
	// `closeDb()` (backup export/import) drops our cached promise but leaves a
	// closed pool behind in that map, so without re-loading here the next
	// transaction would run against it and fail.
	await getDb();
	return invoke<TxResult[]>('db_transaction', {
		db: DB_URL,
		statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] }))
	});
}

export async function select<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
	const db = await getDb();
	return db.select<T[]>(sql, params);
}

export async function selectOne<T>(sql: string, params: SqlParam[] = []): Promise<T | null> {
	const rows = await select<T>(sql, params);
	return rows[0] ?? null;
}

export async function execute(sql: string, params: SqlParam[] = []) {
	const db = await getDb();
	return db.execute(sql, params);
}

/** ISO-8601 UTC timestamp — the format every `*_at` column stores. */
export function now(): string {
	return new Date().toISOString();
}

/** Empty strings from optional inputs should become NULL, not `''`. */
export function nullable(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}
