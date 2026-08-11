use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::{Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

/// File name of the SQLite database. `tauri-plugin-sql` resolves relative
/// `sqlite:` URLs against the app config directory, so this is the single
/// source of truth shared between the plugin and the backup commands below.
const DB_FILE_NAME: &str = "printflow.db";

/// The 16 byte magic header every SQLite 3 database file starts with.
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app config dir unavailable: {e}"))?;
    Ok(dir.join(DB_FILE_NAME))
}

/// Absolute path of the live database — shown in Settings so users can find
/// their data without guessing platform-specific directories.
#[tauri::command]
fn db_file_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(db_path(&app)?.to_string_lossy().into_owned())
}

/// Copy the live database to `destination`.
///
/// The frontend closes the connection pool first, which makes SQLite
/// checkpoint and remove the `-wal` file, so a plain file copy is a complete
/// and consistent snapshot. Any leftover sidecar files are copied defensively
/// in case the pool could not be closed cleanly.
#[tauri::command]
fn export_database(app: tauri::AppHandle, destination: String) -> Result<(), String> {
    let source = db_path(&app)?;
    if !source.exists() {
        return Err("no database file exists yet".into());
    }

    let destination = checked_backup_path(destination, &source)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create target folder: {e}"))?;
    }
    fs::copy(&source, &destination).map_err(|e| format!("copy failed: {e}"))?;

    for suffix in ["-wal", "-shm"] {
        let from = sidecar(&source, suffix);
        if from.exists() {
            let _ = fs::copy(&from, sidecar(&destination, suffix));
        }
    }
    Ok(())
}

/// Replace the live database with the file at `source`.
///
/// The candidate is validated (existence, SQLite magic header) before anything
/// is overwritten, and the current database is kept as `.bak` so a bad import
/// is recoverable. Stale `-wal`/`-shm` sidecars of the *old* database are
/// removed — leaving them would corrupt the freshly imported file.
#[tauri::command]
fn import_database(app: tauri::AppHandle, source: String) -> Result<(), String> {
    let source = checked_backup_path(source, &db_path(&app)?)?;
    let bytes = fs::read(&source).map_err(|e| format!("cannot read backup: {e}"))?;
    if bytes.len() < SQLITE_MAGIC.len() || &bytes[..SQLITE_MAGIC.len()] != SQLITE_MAGIC {
        return Err("selected file is not a SQLite database".into());
    }

    let target = db_path(&app)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create data folder: {e}"))?;
    }
    if target.exists() {
        let backup = target.with_extension("db.bak");
        fs::copy(&target, &backup).map_err(|e| format!("could not back up current database: {e}"))?;
    }

    fs::write(&target, &bytes).map_err(|e| format!("import failed: {e}"))?;
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(sidecar(&target, suffix));
    }
    Ok(())
}

/// Validates a path the frontend chose for a backup file.
///
/// Tauri's threat model treats the frontend as trusted and in practice these
/// paths always come from the native file dialog, so this is defense in depth
/// rather than a boundary: it rejects relative paths, whose meaning would depend
/// on the process working directory, and refuses to let a backup operation touch
/// the live database or its `-wal`/`-shm` sidecars — exporting onto the source
/// would truncate it, and importing from it is never what the user meant.
fn checked_backup_path(candidate: String, live_db: &Path) -> Result<PathBuf, String> {
    let path = PathBuf::from(candidate);
    if !path.is_absolute() {
        return Err("backup path must be absolute".into());
    }
    let forbidden = [
        live_db.to_path_buf(),
        sidecar(live_db, "-wal"),
        sidecar(live_db, "-shm"),
    ];
    if forbidden.contains(&path) {
        return Err("refusing to use the live database as a backup file".into());
    }
    Ok(path)
}

/// `foo.db` + `-wal` -> `foo.db-wal`, matching how SQLite names its sidecars.
fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{}", path.to_string_lossy(), suffix))
}

/// Hand an `http(s)` URL to the user's normal browser.
///
/// PrintFlow is an offline app in a single WebView with no browser chrome: a
/// plain `target="_blank"` link would *replace* the UI with the remote page and
/// leave no way back. Model links (MakerWorld, Printables) therefore go through
/// here, and `navigation_guard()` below cancels any navigation that slips past.
///
/// Only `http` and `https` are accepted — `file:`, `javascript:` and custom
/// schemes are refused, so a URL that arrived via an imported backup cannot be
/// used to launch something local. The URL is passed as a process argument
/// without a shell, and its scheme guarantees it cannot be read as a flag.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(url.trim()).map_err(|_| "not a valid URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("refusing to open a `{}` URL", parsed.scheme()));
    }
    let target = parsed.as_str();

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(target);
        c
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg(target);
        c
    };
    // `rundll32` rather than `cmd /C start`: no shell, so `&` in a query string
    // cannot end up as a command separator.
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler").arg(target);
        c
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open the link: {e}"))
}

/// Cancels every navigation that would take the WebView off the bundled app.
///
/// Defense in depth for [`open_external`]: even if a stray anchor or a script
/// tries to navigate, the window keeps showing PrintFlow.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_webview, url| {
            let local_host = matches!(
                url.host_str(),
                Some("tauri.localhost") | Some("localhost") | Some("127.0.0.1")
            );
            match url.scheme() {
                // Production: `tauri://localhost` (Linux/macOS), custom protocols.
                "tauri" | "asset" | "about" | "blob" | "data" => true,
                // Production on Windows and the dev server.
                "http" | "https" => local_host,
                _ => false,
            }
        })
        .build()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxStatement {
    sql: String,
    #[serde(default)]
    params: Vec<JsonValue>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TxResult {
    rows_affected: u64,
    last_insert_id: i64,
}

/// Run several statements inside a single SQLite transaction.
///
/// `tauri-plugin-sql` exposes a *pool*, so issuing `BEGIN` / `COMMIT` as
/// separate `execute` calls from the frontend is unsafe — each call may land on
/// a different connection. This command borrows the plugin's own pool and uses
/// a real `sqlx` transaction, so the whole batch either lands or does not.
/// Used by the print-job flow, where stock deduction and part counters must
/// never drift apart.
#[tauri::command]
async fn db_transaction(
    instances: State<'_, DbInstances>,
    db: String,
    statements: Vec<TxStatement>,
) -> Result<Vec<TxResult>, String> {
    let pools = instances.0.read().await;
    let DbPool::Sqlite(pool) = pools
        .get(&db)
        .ok_or_else(|| format!("database `{db}` is not loaded"))?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut results = Vec::with_capacity(statements.len());

    for (index, statement) in statements.iter().enumerate() {
        let mut query = sqlx::query(&statement.sql);
        for param in &statement.params {
            query = match param {
                JsonValue::Null => query.bind(None::<String>),
                JsonValue::Bool(v) => query.bind(*v),
                JsonValue::Number(v) => match (v.as_i64(), v.as_f64()) {
                    (Some(i), _) => query.bind(i),
                    (_, Some(f)) => query.bind(f),
                    _ => query.bind(v.to_string()),
                },
                JsonValue::String(v) => query.bind(v.clone()),
                // Arrays/objects are stored as JSON text (the `*_json` columns).
                other => query.bind(other.to_string()),
            };
        }

        let result = query.execute(&mut *tx).await.map_err(|e| {
            format!("statement {} failed, transaction rolled back: {e}", index + 1)
        })?;
        results.push(TxResult {
            rows_affected: result.rows_affected(),
            last_insert_id: result.last_insert_rowid(),
        });
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(results)
}

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_core_schema",
        sql: include_str!("../migrations/001_initial.sql"),
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(navigation_guard())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&format!("sqlite:{DB_FILE_NAME}"), migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            db_file_path,
            export_database,
            import_database,
            open_external,
            db_transaction
        ])
        .run(tauri::generate_context!())
        .expect("error while running PrintFlow");
}
