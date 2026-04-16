use rusqlite::{Connection, Result as SqlResult, params};
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
}
