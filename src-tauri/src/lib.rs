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

/// Extensions the slicer-file scanner reports.
const SLICER_EXTENSIONS: [&str; 3] = ["3mf", "gcode", "gco"];

/// Ceiling on a single slicer file handed to the frontend (400 MB), matching
/// `MAX_FILE_BYTES` in `utils/threemf.ts`.
const MAX_SLICER_FILE_BYTES: u64 = 400 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    /// Absolute path, the identity of the file everywhere else.
    path: String,
    file_name: String,
    /// Directory containing the file, relative to the scanned root. Empty for
    /// files sitting directly in the root.
    folder: String,
    size_bytes: u64,
    /// Unix seconds; `None` when the platform does not report it.
    modified_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    root: String,
    files: Vec<ScannedFile>,
    /// True when the limit was hit, so the UI can say the list is incomplete
    /// rather than implying the drive holds nothing else.
    truncated: bool,
}

/// Recursively finds slicer files below `root`.
///
/// A model library can hold tens of thousands of files across deep folder
/// trees, so the walk is bounded on three axes: `max_depth`, `limit`, and
/// skipping directories that never contain user models. Hidden directories and
/// symlinks are skipped too — the latter because a link pointing at an ancestor
/// would otherwise send the walk in circles.
#[tauri::command]
async fn scan_slicer_files(
    root: String,
    max_depth: Option<u32>,
    limit: Option<usize>,
) -> Result<ScanResult, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_absolute() {
        return Err("scan path must be absolute".into());
    }
    if !root_path.is_dir() {
        return Err("scan path is not a folder".into());
    }

    let max_depth = max_depth.unwrap_or(8);
    let limit = limit.unwrap_or(5_000);
    let mut files = Vec::new();
    let mut truncated = false;

    // Iterative walk with an explicit stack: a deep library must not be able to
    // blow the call stack.
    let mut stack = vec![(root_path.clone(), 0u32)];
    while let Some((dir, depth)) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            // An unreadable folder is normal (permissions, vanished mount) and
            // must not abort a scan that is otherwise working.
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            if files.len() >= limit {
                truncated = true;
                break;
            }

            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }

            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }

            if file_type.is_dir() {
                if depth < max_depth && !is_noise_dir(&name) {
                    stack.push((path, depth + 1));
                }
                continue;
            }

            if !has_slicer_extension(&path) {
                continue;
            }

            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            files.push(ScannedFile {
                folder: relative_folder(&root_path, &path),
                path: path.to_string_lossy().into_owned(),
                file_name: name,
                size_bytes: metadata.len(),
                modified_at: modified_unix_seconds(&metadata),
            });
        }

        if truncated {
            break;
        }
    }

    // Folder first, then name: the order the UI groups by, decided once here so
    // it is stable no matter how the filesystem returned the entries.
    files.sort_by(|a, b| {
        a.folder
            .to_lowercase()
            .cmp(&b.folder.to_lowercase())
            .then_with(|| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()))
    });

    Ok(ScanResult {
        root: root_path.to_string_lossy().into_owned(),
        files,
        truncated,
    })
}

fn has_slicer_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SLICER_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Directories that only ever hold build output or dependencies. Descending
/// into them wastes most of the scan budget on a developer's machine.
fn is_noise_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | "target" | "__pycache__" | "venv" | ".venv" | "$RECYCLE.BIN"
    )
}

fn relative_folder(root: &Path, file: &Path) -> String {
    file.parent()
        .and_then(|parent| parent.strip_prefix(root).ok())
        .map(|rel| rel.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn modified_unix_seconds(metadata: &fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

/// Reads a slicer file so the frontend parser can work on it.
///
/// The frontend never gets a general-purpose file reader: only the extensions
/// the importer understands are accepted, and only up to the same size ceiling
/// the parser enforces, so a mistyped path cannot pull a multi-gigabyte file
/// into the WebView.
#[tauri::command]
async fn read_slicer_file(path: String) -> Result<Vec<u8>, String> {
    let file = PathBuf::from(&path);
    if !file.is_absolute() {
        return Err("file path must be absolute".into());
    }
    if !has_slicer_extension(&file) {
        return Err("not a slicer file".into());
    }
    let metadata = fs::metadata(&file).map_err(|e| format!("cannot read file: {e}"))?;
    if !metadata.is_file() {
        return Err("not a file".into());
    }
    if metadata.len() > MAX_SLICER_FILE_BYTES {
        return Err(format!(
            "file is larger than {} MB",
            MAX_SLICER_FILE_BYTES / (1024 * 1024)
        ));
    }
    fs::read(&file).map_err(|e| format!("cannot read file: {e}"))
}

/// Parses `url` and accepts it only if it is a plain web address.
///
/// Only `http` and `https` pass — `file:`, `javascript:` and custom schemes are
/// refused, so a URL that arrived via an imported backup cannot be used to
/// launch something local.
fn web_url(url: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(url.trim()).map_err(|_| "not a valid URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("refusing to open a `{}` URL", parsed.scheme()));
    }
    Ok(parsed)
}

/// Hand an `http(s)` URL to the user's normal browser.
///
/// PrintFlow is an offline app in a single WebView with no browser chrome: a
/// plain `target="_blank"` link would *replace* the UI with the remote page and
/// leave no way back. Model links (MakerWorld, Printables) therefore go through
/// here, and `navigation_guard()` below cancels any navigation that slips past.
///
/// The URL is passed as a process argument without a shell, and its scheme
/// guarantees it cannot be read as a flag.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = web_url(&url)?;
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
        .on_navigation(|_webview, url| is_app_origin(url))
        .build()
}

/// Whether `url` belongs to the bundled app rather than the open web.
///
/// The app is served from `tauri://localhost` on Linux and macOS, from
/// `http://tauri.localhost` on Windows, and from the Vite dev server while
/// developing — all three have to pass, or the window comes up blank.
fn is_app_origin(url: &tauri::Url) -> bool {
    let local_host = matches!(
        url.host_str(),
        Some("tauri.localhost") | Some("localhost") | Some("127.0.0.1")
    );
    match url.scheme() {
        "tauri" | "asset" | "about" | "blob" | "data" => true,
        "http" | "https" => local_host,
        _ => false,
    }
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
    vec![
        Migration {
            version: 1,
            description: "create_core_schema",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_print_plan",
            sql: include_str!("../migrations/002_print_plan.sql"),
            kind: MigrationKind::Up,
        },
    ]
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
            scan_slicer_files,
            read_slicer_file,
            db_transaction
        ])
        .run(tauri::generate_context!())
        .expect("error while running PrintFlow");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_web_addresses() {
        assert!(web_url("https://makerworld.com/en/models/12345").is_ok());
        assert!(web_url("http://192.168.1.50:8080/print").is_ok());
        // Surrounding whitespace is a paste artefact, not a different URL.
        assert!(web_url("  https://printables.com/model/7  ").is_ok());
    }

    #[test]
    fn refuses_everything_that_is_not_http() {
        // The cases that matter: a restored backup could hold any of these.
        for url in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,<script>alert(1)</script>",
            "tauri://localhost/settings",
            "not a url at all",
            "",
        ] {
            assert!(web_url(url).is_err(), "should have refused `{url}`");
        }
    }

    #[test]
    fn recognises_only_slicer_extensions() {
        for name in ["a.3mf", "a.3MF", "a.gcode", "a.GCode", "a.gco"] {
            assert!(has_slicer_extension(Path::new(name)), "{name}");
        }
        for name in ["a.stl", "a.step", "a.png", "a.3mf.bak", "a", "a."] {
            assert!(!has_slicer_extension(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn folder_is_relative_to_the_scanned_root() {
        let root = Path::new("/home/u/models");
        assert_eq!(relative_folder(root, Path::new("/home/u/models/a.3mf")), "");
        assert_eq!(
            relative_folder(root, Path::new("/home/u/models/Table/Legs/a.3mf")),
            "Table/Legs"
        );
    }

    /// Builds a small library on disk and checks what the walk reports: nested
    /// files are found, non-slicer files and hidden or noise folders are not.
    #[test]
    fn scan_walks_nested_folders_and_skips_noise() {
        let root = std::env::temp_dir().join(format!("printflow-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for dir in ["Table/Legs", "Kiste", ".hidden", "node_modules/pkg"] {
            fs::create_dir_all(root.join(dir)).unwrap();
        }
        for file in [
            "top.3mf",
            "notes.txt",
            "Table/plate.gcode",
            "Table/Legs/leg.3mf",
            "Kiste/box.gco",
            "Kiste/model.stl",
            ".hidden/secret.3mf",
            "node_modules/pkg/vendor.3mf",
        ] {
            fs::write(root.join(file), b"x").unwrap();
        }

        let result = tauri::async_runtime::block_on(scan_slicer_files(
            root.to_string_lossy().into_owned(),
            None,
            None,
        ))
        .unwrap();

        // Sorted by folder, then by name — root first, then folders in order.
        let names: Vec<&str> = result.files.iter().map(|f| f.file_name.as_str()).collect();
        assert_eq!(names, vec!["top.3mf", "box.gco", "plate.gcode", "leg.3mf"]);
        // Folders come back relative, so the UI can group without string surgery.
        let folders: Vec<&str> = result.files.iter().map(|f| f.folder.as_str()).collect();
        assert_eq!(folders, vec!["", "Kiste", "Table", "Table/Legs"]);
        assert!(!result.truncated);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_respects_depth_and_limit() {
        let root = std::env::temp_dir().join(format!("printflow-depth-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("a/b/c")).unwrap();
        fs::write(root.join("a/one.3mf"), b"x").unwrap();
        fs::write(root.join("a/b/two.3mf"), b"x").unwrap();
        fs::write(root.join("a/b/c/three.3mf"), b"x").unwrap();

        let shallow = tauri::async_runtime::block_on(scan_slicer_files(
            root.to_string_lossy().into_owned(),
            Some(1),
            None,
        ))
        .unwrap();
        assert_eq!(shallow.files.len(), 1, "depth 1 reaches a/ only");

        let capped = tauri::async_runtime::block_on(scan_slicer_files(
            root.to_string_lossy().into_owned(),
            None,
            Some(2),
        ))
        .unwrap();
        assert_eq!(capped.files.len(), 2);
        assert!(capped.truncated, "a capped scan must say so");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn read_slicer_file_refuses_anything_else() {
        let dir = std::env::temp_dir().join(format!("printflow-read-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let allowed = dir.join("model.3mf");
        let refused = dir.join("notes.txt");
        fs::write(&allowed, b"hello").unwrap();
        fs::write(&refused, b"hello").unwrap();

        let read = |p: &Path| {
            tauri::async_runtime::block_on(read_slicer_file(p.to_string_lossy().into_owned()))
        };
        assert_eq!(read(&allowed).unwrap(), b"hello");
        assert!(read(&refused).is_err(), "wrong extension");
        assert!(read(&dir).is_err(), "a folder is not a file");
        assert!(read(Path::new("relative.3mf")).is_err(), "relative path");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_path_must_be_absolute() {
        let live = Path::new("/home/u/.config/app.printflow.desktop/printflow.db");
        assert!(checked_backup_path("backup.db".into(), live).is_err());
        assert!(checked_backup_path("../../etc/x.db".into(), live).is_err());
        assert!(checked_backup_path("/home/u/backup.db".into(), live).is_ok());
    }

    #[test]
    fn backup_path_never_targets_the_live_database() {
        let live = Path::new("/home/u/.config/app.printflow.desktop/printflow.db");
        for candidate in [
            "/home/u/.config/app.printflow.desktop/printflow.db",
            "/home/u/.config/app.printflow.desktop/printflow.db-wal",
            "/home/u/.config/app.printflow.desktop/printflow.db-shm",
        ] {
            assert!(
                checked_backup_path(candidate.into(), live).is_err(),
                "should have refused `{candidate}`"
            );
        }
    }

    /// The guard has to let the app's own origin through on every platform —
    /// getting this wrong ships a blank window.
    #[test]
    fn guard_allows_the_app_and_blocks_the_web() {
        let allowed = |url: &str| is_app_origin(&tauri::Url::parse(url).unwrap());

        assert!(allowed("tauri://localhost"), "production on Linux/macOS");
        assert!(allowed("http://tauri.localhost/"), "production on Windows");
        assert!(allowed("http://localhost:1420/"), "dev server");
        assert!(allowed("about:blank"));

        assert!(!allowed("https://makerworld.com/"));
        assert!(!allowed("file:///etc/passwd"));
    }
}
