use rusqlite::{Connection, Result as SqlResult, params};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(app_data_dir: PathBuf) -> SqlResult<Self> {
        std::fs::create_dir_all(&app_data_dir).ok();
        let db_path = app_data_dir.join("open_cowork.db");
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Self { conn: Mutex::new(conn) };
        db.migrate()?;
        Ok(db)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        let db = Self { conn: Mutex::new(conn) };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL
            );

            INSERT INTO schema_version (version)
            SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM schema_version);"
        )?;

        let version: i64 = conn.query_row(
            "SELECT version FROM schema_version LIMIT 1",
            [],
            |row| row.get(0),
        )?;

        if version < 1 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS chat_threads (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS chat_messages (
                    id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_messages_thread ON chat_messages(thread_id, timestamp);

                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'created',
                    thread_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    error TEXT,
                    FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE SET NULL
                );

                CREATE TABLE IF NOT EXISTS task_steps (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    idx INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'pending',
                    requires_approval INTEGER NOT NULL DEFAULT 0,
                    risk_level TEXT NOT NULL DEFAULT 'low',
                    output TEXT,
                    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_steps_task ON task_steps(task_id, idx);

                CREATE TABLE IF NOT EXISTS audit_events (
                    id TEXT PRIMARY KEY,
                    ts TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    resource_type TEXT,
                    resource_id TEXT,
                    details_json TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts, event_type);

                UPDATE schema_version SET version = 1;"
            )?;
        }

        if version < 2 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS allowed_folders (
                    path TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                UPDATE schema_version SET version = 2;"
            )?;
        }

        if version < 3 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS artifact_versions (
                    id TEXT PRIMARY KEY,
                    run_id TEXT,
                    label TEXT,
                    source_path TEXT NOT NULL,
                    format TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    summary TEXT NOT NULL,
                    preview TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_artifact_versions_created_at
                    ON artifact_versions(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_artifact_versions_run_id
                    ON artifact_versions(run_id, created_at DESC);

                UPDATE schema_version SET version = 3;"
            )?;
        }

        if version < 4 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS scheduled_tasks (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    schedule_expr TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    last_run_at TEXT,
                    next_run_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run
                    ON scheduled_tasks(active, next_run_at);

                CREATE TABLE IF NOT EXISTS scheduled_runs (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    result TEXT,
                    error TEXT,
                    FOREIGN KEY(task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_scheduled_runs_task
                    ON scheduled_runs(task_id, started_at DESC);

                UPDATE schema_version SET version = 4;"
            )?;
        }

        if version < 5 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS artifact_exports (
                    id TEXT PRIMARY KEY,
                    artifact_version_id TEXT NOT NULL,
                    export_format TEXT NOT NULL,
                    target_path TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(artifact_version_id) REFERENCES artifact_versions(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_artifact_exports_created_at
                    ON artifact_exports(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_artifact_exports_version_id
                    ON artifact_exports(artifact_version_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS policy_flags (
                    key TEXT PRIMARY KEY,
                    value INTEGER NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS policy_deny_rules (
                    rule TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                UPDATE schema_version SET version = 5;"
            )?;
        }

        Ok(())
    }

    // -- Chat Threads --

    pub fn insert_thread(&self, id: &str, title: &str, created_at: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO chat_threads (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![id, title, created_at],
        )?;
        Ok(())
    }

    pub fn list_threads(&self) -> SqlResult<Vec<(String, String, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at FROM chat_threads ORDER BY updated_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?;
        rows.collect()
    }

    pub fn delete_thread(&self, id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM chat_threads WHERE id = ?1", params![id])?;
        Ok(())
    }

    // -- Chat Messages --

    pub fn insert_message(
        &self, id: &str, thread_id: &str, role: &str, content: &str, timestamp: i64,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO chat_messages (id, thread_id, role, content, timestamp) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, thread_id, role, content, timestamp],
        )?;
        conn.execute(
            "UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?1",
            params![thread_id],
        )?;
        Ok(())
    }

    pub fn list_messages(&self, thread_id: &str) -> SqlResult<Vec<(String, String, String, i64)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, role, content, timestamp FROM chat_messages WHERE thread_id = ?1 ORDER BY timestamp"
        )?;
        let rows = stmt.query_map(params![thread_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?;
        rows.collect()
    }

    // -- Tasks --

    pub fn insert_task(
        &self, id: &str, title: &str, prompt: &str, status: &str, thread_id: Option<&str>, created_at: &str,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, prompt, status, thread_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![id, title, prompt, status, thread_id, created_at],
        )?;
        Ok(())
    }

    pub fn update_task_status(&self, id: &str, status: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tasks SET status = ?2, updated_at = datetime('now') WHERE id = ?1",
            params![id, status],
        )?;
        Ok(())
    }

    pub fn set_task_error(&self, id: &str, error: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tasks SET error = ?2, status = 'failed', updated_at = datetime('now') WHERE id = ?1",
            params![id, error],
        )?;
        Ok(())
    }

    pub fn list_tasks(&self) -> SqlResult<Vec<(String, String, String, String, Option<String>, String, String, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, prompt, status, thread_id, created_at, updated_at, error FROM tasks ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))
        })?;
        rows.collect()
    }

    // -- Task Steps --

    pub fn insert_step(
        &self, id: &str, task_id: &str, idx: i32, title: &str, state: &str,
        requires_approval: bool, risk_level: &str,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO task_steps (id, task_id, idx, title, state, requires_approval, risk_level) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, task_id, idx, title, state, requires_approval as i32, risk_level],
        )?;
        Ok(())
    }

    pub fn update_step_state(&self, id: &str, state: &str, output: Option<&str>) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE task_steps SET state = ?2, output = ?3 WHERE id = ?1",
            params![id, state, output],
        )?;
        Ok(())
    }

    pub fn list_steps(&self, task_id: &str) -> SqlResult<Vec<(String, i32, String, String, bool, String, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, idx, title, state, requires_approval, risk_level, output FROM task_steps WHERE task_id = ?1 ORDER BY idx"
        )?;
        let rows = stmt.query_map(params![task_id], |row| {
            let approval: i32 = row.get(4)?;
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, approval != 0, row.get(5)?, row.get(6)?))
        })?;
        rows.collect()
    }

    // -- Audit --

    pub fn insert_audit_event(
        &self, id: &str, ts: &str, event_type: &str,
        resource_type: Option<&str>, resource_id: Option<&str>, details_json: Option<&str>,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO audit_events (id, ts, event_type, resource_type, resource_id, details_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, ts, event_type, resource_type, resource_id, details_json],
        )?;
        Ok(())
    }

    // -- File Safety --

    pub fn add_allowed_folder(&self, path: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO allowed_folders (path, created_at) VALUES (?1, datetime('now'))",
            params![path],
        )?;
        Ok(())
    }

    pub fn remove_allowed_folder(&self, path: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM allowed_folders WHERE path = ?1", params![path])?;
        Ok(())
    }

    pub fn list_allowed_folders(&self) -> SqlResult<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT path FROM allowed_folders ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    }

    // -- Runtime Policy --

    pub fn set_policy_flag(&self, key: &str, value: bool) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO policy_flags (key, value, updated_at)
             VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at",
            params![key, value as i32],
        )?;
        Ok(())
    }

    pub fn list_policy_flags(&self) -> SqlResult<Vec<(String, bool)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value FROM policy_flags")?;
        let rows = stmt.query_map([], |row| {
            let value: i32 = row.get(1)?;
            Ok((row.get(0)?, value != 0))
        })?;
        rows.collect()
    }

    pub fn replace_policy_deny_rules(&self, rules: &[String]) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM policy_deny_rules", [])?;

        let mut seen = HashSet::new();
        for raw_rule in rules {
            let rule = raw_rule.trim();
            if rule.is_empty() {
                continue;
            }
            if !seen.insert(rule.to_string()) {
                continue;
            }
            tx.execute(
                "INSERT INTO policy_deny_rules (rule, created_at) VALUES (?1, datetime('now'))",
                params![rule],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn list_policy_deny_rules(&self) -> SqlResult<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT rule FROM policy_deny_rules ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    }

    // -- Artifact Versions --

    pub fn insert_artifact_version(
        &self,
        id: &str,
        run_id: Option<&str>,
        label: Option<&str>,
        source_path: &str,
        format: &str,
        size_bytes: i64,
        summary: &str,
        preview: &str,
        metadata_json: &str,
        created_at: &str,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO artifact_versions (
                id, run_id, label, source_path, format, size_bytes, summary, preview, metadata_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                run_id,
                label,
                source_path,
                format,
                size_bytes,
                summary,
                preview,
                metadata_json,
                created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_artifact_versions(
        &self,
        limit: i64,
    ) -> SqlResult<Vec<(String, Option<String>, Option<String>, String, String, i64, String, String, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT
                id,
                run_id,
                label,
                source_path,
                format,
                size_bytes,
                summary,
                preview,
                metadata_json,
                created_at
             FROM artifact_versions
             ORDER BY created_at DESC
             LIMIT ?1"
        )?;

        let rows = stmt.query_map(params![limit], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
            ))
        })?;

        rows.collect()
    }

    pub fn get_artifact_version_by_id(
        &self,
        artifact_version_id: &str,
    ) -> SqlResult<Option<(String, Option<String>, Option<String>, String, String, i64, String, String, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT
                id,
                run_id,
                label,
                source_path,
                format,
                size_bytes,
                summary,
                preview,
                metadata_json,
                created_at
             FROM artifact_versions
             WHERE id = ?1
             LIMIT 1"
        )?;

        let mut rows = stmt.query(params![artifact_version_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
            )))
        } else {
            Ok(None)
        }
    }

    pub fn insert_artifact_export(
        &self,
        id: &str,
        artifact_version_id: &str,
        export_format: &str,
        target_path: &str,
        size_bytes: i64,
        created_at: &str,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO artifact_exports (
                id,
                artifact_version_id,
                export_format,
                target_path,
                size_bytes,
                created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, artifact_version_id, export_format, target_path, size_bytes, created_at],
        )?;
        Ok(())
    }

    pub fn list_artifact_exports(
        &self,
        limit: i64,
    ) -> SqlResult<Vec<(String, String, String, String, i64, String, String, Option<String>, Option<String>, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT
                e.id,
                e.artifact_version_id,
                e.export_format,
                e.target_path,
                e.size_bytes,
                e.created_at,
                v.source_path,
                v.run_id,
                v.label,
                v.format
             FROM artifact_exports e
             JOIN artifact_versions v ON v.id = e.artifact_version_id
             ORDER BY e.created_at DESC
             LIMIT ?1"
        )?;

        let rows = stmt.query_map(params![limit], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
            ))
        })?;

        rows.collect()
    }

    // -- Scheduler --

    pub fn upsert_scheduled_task(
        &self,
        id: &str,
        name: &str,
        prompt: &str,
        schedule_expr: &str,
        active: bool,
        last_run_at: Option<&str>,
        next_run_at: Option<&str>,
        now: &str,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO scheduled_tasks (
                id, name, prompt, schedule_expr, active, last_run_at, next_run_at, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                prompt = excluded.prompt,
                schedule_expr = excluded.schedule_expr,
                active = excluded.active,
                last_run_at = excluded.last_run_at,
                next_run_at = excluded.next_run_at,
                updated_at = excluded.updated_at",
            params![
                id,
                name,
                prompt,
                schedule_expr,
                active as i32,
                last_run_at,
                next_run_at,
                now
            ],
        )?;
        Ok(())
    }

    pub fn list_scheduled_tasks(&self) -> SqlResult<Vec<(String, String, String, String, bool, Option<String>, Option<String>, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, prompt, schedule_expr, active, last_run_at, next_run_at, created_at, updated_at
             FROM scheduled_tasks
             ORDER BY created_at DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            let active_value: i32 = row.get(4)?;
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                active_value != 0,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
            ))
        })?;

        rows.collect()
    }

    pub fn delete_scheduled_task(&self, id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM scheduled_tasks WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn set_scheduled_task_active(&self, id: &str, active: bool, next_run_at: Option<&str>) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE scheduled_tasks
             SET active = ?2, next_run_at = ?3, updated_at = datetime('now')
             WHERE id = ?1",
            params![id, active as i32, next_run_at],
        )?;
        Ok(())
    }

    pub fn list_due_scheduled_tasks(&self, now: &str) -> SqlResult<Vec<(String, String, String, String, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, prompt, schedule_expr, next_run_at
             FROM scheduled_tasks
             WHERE active = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?1
             ORDER BY next_run_at ASC"
        )?;

        let rows = stmt.query_map(params![now], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })?;

        rows.collect()
    }

    pub fn update_scheduled_task_runtime(&self, id: &str, last_run_at: Option<&str>, next_run_at: Option<&str>) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE scheduled_tasks
             SET last_run_at = ?2, next_run_at = ?3, updated_at = datetime('now')
             WHERE id = ?1",
            params![id, last_run_at, next_run_at],
        )?;
        Ok(())
    }

    pub fn insert_scheduled_run(
        &self,
        id: &str,
        task_id: &str,
        status: &str,
        started_at: &str,
        finished_at: Option<&str>,
        result: Option<&str>,
        error: Option<&str>,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO scheduled_runs (id, task_id, status, started_at, finished_at, result, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, task_id, status, started_at, finished_at, result, error],
        )?;
        Ok(())
    }

    pub fn list_scheduled_runs(&self, limit: i64) -> SqlResult<Vec<(String, String, String, String, Option<String>, Option<String>, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, status, started_at, finished_at, result, error
             FROM scheduled_runs
             ORDER BY started_at DESC
             LIMIT ?1"
        )?;

        let rows = stmt.query_map(params![limit], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })?;

        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_creates_tables() {
        let db = Database::open_in_memory().unwrap();
        db.insert_thread("t1", "Test Thread", "2025-01-01T00:00:00").unwrap();
        let threads = db.list_threads().unwrap();
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].0, "t1");
    }

    #[test]
    fn messages_round_trip() {
        let db = Database::open_in_memory().unwrap();
        db.insert_thread("t1", "Thread", "2025-01-01T00:00:00").unwrap();
        db.insert_message("m1", "t1", "user", "Hello", 1000).unwrap();
        db.insert_message("m2", "t1", "assistant", "Hi", 1001).unwrap();
        let msgs = db.list_messages("t1").unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].1, "user");
        assert_eq!(msgs[1].1, "assistant");
    }

    #[test]
    fn task_lifecycle() {
        let db = Database::open_in_memory().unwrap();
        db.insert_task("task1", "Test", "Do stuff", "created", None, "2025-01-01T00:00:00").unwrap();
        db.update_task_status("task1", "planned").unwrap();
        let tasks = db.list_tasks().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].3, "planned");
    }

    #[test]
    fn steps_with_task() {
        let db = Database::open_in_memory().unwrap();
        db.insert_task("task1", "Test", "Do stuff", "created", None, "2025-01-01T00:00:00").unwrap();
        db.insert_step("s1", "task1", 0, "Step 1", "pending", false, "low").unwrap();
        db.insert_step("s2", "task1", 1, "Step 2", "pending", true, "medium").unwrap();
        let steps = db.list_steps("task1").unwrap();
        assert_eq!(steps.len(), 2);
        assert!(steps[1].4); // requires_approval
    }

    #[test]
    fn delete_thread_cascades() {
        let db = Database::open_in_memory().unwrap();
        db.insert_thread("t1", "Thread", "2025-01-01T00:00:00").unwrap();
        db.insert_message("m1", "t1", "user", "Hello", 1000).unwrap();
        db.delete_thread("t1").unwrap();
        let msgs = db.list_messages("t1").unwrap();
        assert_eq!(msgs.len(), 0);
    }

    #[test]
    fn audit_event_insert() {
        let db = Database::open_in_memory().unwrap();
        db.insert_audit_event("a1", "2025-01-01T00:00:00", "task_created", Some("task"), Some("task1"), None).unwrap();
    }

    #[test]
    fn artifact_versions_round_trip() {
        let db = Database::open_in_memory().unwrap();
        db.insert_artifact_version(
            "v1",
            Some("run-1"),
            Some("initial"),
            "C:/tmp/report.md",
            "text/plain",
            123,
            "summary",
            "preview",
            "{}",
            "2026-04-16T19:00:00Z",
        )
        .unwrap();

        let rows = db.list_artifact_versions(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "v1");
        assert_eq!(rows[0].1.as_deref(), Some("run-1"));
        assert_eq!(rows[0].3, "C:/tmp/report.md");
    }

    #[test]
    fn artifact_exports_round_trip() {
        let db = Database::open_in_memory().unwrap();
        db.insert_artifact_version(
            "v1",
            Some("run-1"),
            Some("initial"),
            "C:/tmp/report.md",
            "text/plain",
            123,
            "summary",
            "preview",
            "{}",
            "2026-04-16T19:00:00Z",
        )
        .unwrap();

        db.insert_artifact_export(
            "e1",
            "v1",
            "json",
            "C:/tmp/export/report.json",
            512,
            "2026-04-16T19:01:00Z",
        )
        .unwrap();

        let rows = db.list_artifact_exports(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "e1");
        assert_eq!(rows[0].1, "v1");
        assert_eq!(rows[0].2, "json");
    }
}
