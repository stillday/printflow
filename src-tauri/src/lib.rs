use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::{Emitter, Manager, State};
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
    /// True when a limit was hit, so the UI can say the list is incomplete
    /// rather than implying the drive holds nothing else.
    truncated: bool,
    /// The time budget ran out. Distinct from `truncated` on purpose: it almost
    /// always means the folder is a network or cloud mount, which needs a
    /// different hint than "there are more files".
    timed_out: bool,
    /// Directories visited, so the UI can report what the scan got through.
    folders_scanned: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    folders_scanned: u32,
    files_found: u32,
}

/// Recursively finds slicer files below `root`.
///
/// A model library can hold tens of thousands of files across deep folder
/// trees, so the walk is bounded on four axes: `max_depth`, `limit`, a wall-clock
/// budget, and skipping directories that never contain user models. Hidden
/// directories and symlinks are skipped too — the latter because a link pointing
/// at an ancestor would otherwise send the walk in circles.
///
/// The time budget is what makes this usable on a cloud mount: a recursive walk
/// of a Google Drive or network share pays round-trip latency per directory and
/// can run for many minutes, so the scan returns what it has and says it ran
/// out of time. Progress is emitted as `scan-progress` events meanwhile, so the
/// UI never looks frozen.
#[tauri::command]
async fn scan_slicer_files(
    app: tauri::AppHandle,
    root: String,
    max_depth: Option<u32>,
    limit: Option<usize>,
    timeout_secs: Option<u64>,
) -> Result<ScanResult, String> {
    let budget = std::time::Duration::from_secs(timeout_secs.unwrap_or(30).clamp(1, 600));
    walk_slicer_files(
        &root,
        max_depth.unwrap_or(8),
        limit.unwrap_or(5_000),
        budget,
        |folders_scanned, files_found| {
            let _ = app.emit(
                "scan-progress",
                ScanProgress {
                    folders_scanned,
                    files_found,
                },
            );
        },
    )
}

/// The walk itself, free of Tauri so it can be tested directly.
///
/// `on_progress` is called every 25 directories — often enough to look alive
/// without flooding the event channel on a fast local disk.
fn walk_slicer_files(
    root: &str,
    max_depth: u32,
    limit: usize,
    budget: std::time::Duration,
    mut on_progress: impl FnMut(u32, u32),
) -> Result<ScanResult, String> {
    let root_path = PathBuf::from(root);
    if !root_path.is_absolute() {
        return Err("scan path must be absolute".into());
    }
    if !root_path.is_dir() {
        return Err("scan path is not a folder".into());
    }

    let deadline = std::time::Instant::now() + budget;
    let mut files: Vec<ScannedFile> = Vec::new();
    let mut truncated = false;
    let mut timed_out = false;
    let mut folders_scanned: u32 = 0;

    // Iterative walk with an explicit stack: a deep library must not be able to
    // blow the call stack.
    let mut stack = vec![(root_path.clone(), 0u32)];
    while let Some((dir, depth)) = stack.pop() {
        if std::time::Instant::now() >= deadline {
            timed_out = true;
            truncated = true;
            break;
        }

        folders_scanned += 1;
        if folders_scanned % 25 == 0 {
            on_progress(folders_scanned, files.len() as u32);
        }

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

        if truncated && !timed_out {
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
        timed_out,
        folders_scanned,
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

/* -------------------------------------------------------------------------- */
/* Model portals — the app's only network access                              */
/* -------------------------------------------------------------------------- */

/*
 * Everything below is the one place PrintFlow talks to the internet, and it is
 * deliberately here in Rust rather than in the WebView: the Content-Security-
 * Policy stays `'self'`, so the UI itself still cannot reach the network even by
 * accident. A fetched preview is stored locally and rendered from the database,
 * so a project keeps its picture offline afterwards.
 *
 * These commands are reached only from the "online features" switch in Settings,
 * which is off by default. That switch is a product gate; the guarantees that
 * hold regardless of it are enforced right here: an allowlist of model portals,
 * https only for the image itself, hard size caps and short timeouts.
 */

/// Model portals whose pages may be fetched. Matched as a domain suffix, so
/// `www.` and regional subdomains work without listing each one.
const MODEL_PORTALS: [&str; 6] = [
    "makerworld.com",
    "printables.com",
    "thingiverse.com",
    "cults3d.com",
    "myminifactory.com",
    "thangs.com",
];

/// Enough for any model page; a page that needs more is not one we can read.
const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;
/// Preview images are thumbnails, not print files.
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
/// A print file can legitimately be large, but not unbounded.
const MAX_DOWNLOAD_BYTES: u64 = 500 * 1024 * 1024;

const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Portals reject the default client string, so identify the app honestly.
const USER_AGENT: &str = concat!("PrintFlow/", env!("CARGO_PKG_VERSION"), " (desktop app)");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPreview {
    /// The image itself, base64 — stored in the database and rendered from a
    /// `data:` URI, which the existing CSP already allows.
    image_base64: String,
    content_type: String,
    /// Where the image came from, for provenance.
    image_url: String,
    /// The page's `og:title`, offered as a project name.
    title: Option<String>,
}

fn is_model_portal(url: &tauri::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    MODEL_PORTALS
        .iter()
        .any(|portal| host == *portal || host.ends_with(&format!(".{portal}")))
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("could not set up the network client: {e}"))
}

/// Reads a page's first `<meta property="og:…" content="…">` value.
///
/// A dependency-free scan rather than a parser: only two tags are needed, the
/// attribute order varies between portals, and a hand-rolled scan cannot be
/// tripped by malformed markup elsewhere on a very large page.
fn og_content(html: &str, property: &str) -> Option<String> {
    let needle = format!("og:{property}");
    for tag in html.split('<') {
        if !tag.starts_with("meta") || !tag.contains(&needle) {
            continue;
        }
        // Guard against `og:image:width` matching a request for `og:image`.
        let after = tag.split(&needle).nth(1)?;
        if after.starts_with(':') {
            continue;
        }
        if let Some(value) = attribute_value(tag, "content") {
            if !value.trim().is_empty() {
                return Some(decode_entities(value.trim()));
            }
        }
    }
    None
}

fn attribute_value(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0usize;
    while let Some(found) = lower[from..].find(name) {
        let start = from + found;
        let rest = &tag[start + name.len()..];
        let trimmed = rest.trim_start();
        if let Some(after_eq) = trimmed.strip_prefix('=') {
            let value = after_eq.trim_start();
            let quote = value.chars().next()?;
            if quote == '"' || quote == '\'' {
                let inner = &value[1..];
                let end = inner.find(quote)?;
                return Some(inner[..end].to_string());
            }
        }
        from = start + name.len();
    }
    None
}

/// The handful of entities that actually turn up in `og:` values.
fn decode_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

/// Base64 without a dependency — the alphabet is fixed and this runs once per
/// fetched image.
fn to_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let triple = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(ALPHABET[(triple >> 18 & 63) as usize] as char);
        out.push(ALPHABET[(triple >> 12 & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(triple >> 6 & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(triple & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Fetches a model page's preview image so a project can show it offline.
#[tauri::command]
async fn fetch_model_preview(url: String) -> Result<ModelPreview, String> {
    let page_url = web_url(&url)?;
    if !is_model_portal(&page_url) {
        return Err(format!(
            "`{}` is not one of the supported model portals",
            page_url.host_str().unwrap_or("?")
        ));
    }

    let http = client()?;
    let response = http
        .get(page_url.clone())
        .send()
        .await
        .map_err(|e| format!("could not reach the page: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("the page answered {}", response.status()));
    }

    let body = response
        .bytes()
        .await
        .map_err(|e| format!("could not read the page: {e}"))?;
    let html = String::from_utf8_lossy(&body[..body.len().min(MAX_PAGE_BYTES)]);

    let raw_image = og_content(&html, "image").ok_or_else(|| {
        "the page carries no preview image (no og:image tag)".to_string()
    })?;
    // Portals sometimes give a path rather than an absolute URL.
    let image_url = page_url
        .join(&raw_image)
        .map_err(|_| "the preview image address is not usable".to_string())?;
    if image_url.scheme() != "https" {
        return Err("the preview image is not served over https".into());
    }

    let image_response = http
        .get(image_url.clone())
        .send()
        .await
        .map_err(|e| format!("could not fetch the preview image: {e}"))?;
    if !image_response.status().is_success() {
        return Err(format!(
            "the preview image answered {}",
            image_response.status()
        ));
    }

    let content_type = image_response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
        .unwrap_or_else(|| "image/jpeg".to_string());
    if !content_type.starts_with("image/") {
        return Err(format!("that address returned `{content_type}`, not an image"));
    }

    let image_bytes = image_response
        .bytes()
        .await
        .map_err(|e| format!("could not read the preview image: {e}"))?;
    if image_bytes.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "the preview image is larger than {} MB",
            MAX_IMAGE_BYTES / (1024 * 1024)
        ));
    }

    Ok(ModelPreview {
        image_base64: to_base64(&image_bytes),
        content_type,
        image_url: image_url.to_string(),
        title: og_content(&html, "title"),
    })
}

/// Downloads a direct file URL into the user's model library.
///
/// The portals require a signed-in session for their own download endpoints, so
/// this is for links the user already has. An existing file is never
/// overwritten, and the bytes land in a `.part` file that is renamed on success,
/// so an interrupted download cannot leave something that looks complete.
#[tauri::command]
async fn download_file(url: String, target_path: String) -> Result<u64, String> {
    let source = web_url(&url)?;
    let target = PathBuf::from(&target_path);
    if !target.is_absolute() {
        return Err("target path must be absolute".into());
    }
    if target.exists() {
        return Err("a file of that name already exists".into());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "target path has no folder".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("cannot create target folder: {e}"))?;

    let response = client()?
        .get(source)
        .send()
        .await
        .map_err(|e| format!("could not reach the file: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("the server answered {}", response.status()));
    }
    if let Some(length) = response.content_length() {
        if length > MAX_DOWNLOAD_BYTES {
            return Err(format!(
                "the file is larger than {} MB",
                MAX_DOWNLOAD_BYTES / (1024 * 1024)
            ));
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("could not read the file: {e}"))?;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err(format!(
            "the file is larger than {} MB",
            MAX_DOWNLOAD_BYTES / (1024 * 1024)
        ));
    }

    let partial = sidecar(&target, ".part");
    fs::write(&partial, &bytes).map_err(|e| format!("could not write the file: {e}"))?;
    fs::rename(&partial, &target).map_err(|e| {
        let _ = fs::remove_file(&partial);
        format!("could not finish the download: {e}")
    })?;
    Ok(bytes.len() as u64)
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
        Migration {
            version: 3,
            description: "plate_source_path",
            sql: include_str!("../migrations/003_plate_source_path.sql"),
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
            fetch_model_preview,
            download_file,
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
        let root = absolute("models");
        assert_eq!(relative_folder(&root, &root.join("a.3mf")), "");
        // The separator is the platform's own, so build the expectation that way.
        let nested = root.join("Table").join("Legs").join("a.3mf");
        let expected = Path::new("Table").join("Legs").to_string_lossy().into_owned();
        assert_eq!(relative_folder(&root, &nested), expected);
    }

    /// Builds a small library on disk and checks what the walk reports: nested
    /// files are found, non-slicer files and hidden or noise folders are not.
    #[test]
    fn scan_walks_nested_folders_and_skips_noise() {
        let root = std::env::temp_dir().join(format!("printflow-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for dir in [
            vec!["Table", "Legs"],
            vec!["Kiste"],
            vec![".hidden"],
            vec!["node_modules", "pkg"],
        ] {
            fs::create_dir_all(dir.iter().fold(root.clone(), |p, part| p.join(part))).unwrap();
        }
        for file in [
            vec!["top.3mf"],
            vec!["notes.txt"],
            vec!["Table", "plate.gcode"],
            vec!["Table", "Legs", "leg.3mf"],
            vec!["Kiste", "box.gco"],
            vec!["Kiste", "model.stl"],
            vec![".hidden", "secret.3mf"],
            vec!["node_modules", "pkg", "vendor.3mf"],
        ] {
            fs::write(file.iter().fold(root.clone(), |p, part| p.join(part)), b"x").unwrap();
        }

        let result = scan(&root, 8, 5_000).unwrap();

        // Sorted by folder, then by name — root first, then folders in order.
        let names: Vec<&str> = result.files.iter().map(|f| f.file_name.as_str()).collect();
        assert_eq!(names, vec!["top.3mf", "box.gco", "plate.gcode", "leg.3mf"]);
        // Folders come back relative, so the UI can group without string surgery.
        let folders: Vec<&str> = result.files.iter().map(|f| f.folder.as_str()).collect();
        let table_legs = Path::new("Table").join("Legs").to_string_lossy().into_owned();
        assert_eq!(folders, vec!["", "Kiste", "Table", table_legs.as_str()]);
        assert!(!result.truncated);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_respects_depth_and_limit() {
        let root = std::env::temp_dir().join(format!("printflow-depth-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("a").join("b").join("c")).unwrap();
        fs::write(root.join("a").join("one.3mf"), b"x").unwrap();
        fs::write(root.join("a").join("b").join("two.3mf"), b"x").unwrap();
        fs::write(root.join("a").join("b").join("c").join("three.3mf"), b"x").unwrap();

        let shallow = scan(&root, 1, 5_000).unwrap();
        assert_eq!(shallow.files.len(), 1, "depth 1 reaches a/ only");

        let capped = scan(&root, 8, 2).unwrap();
        assert_eq!(capped.files.len(), 2);
        assert!(capped.truncated, "a capped scan must say so");

        let _ = fs::remove_dir_all(&root);
    }

    /// A cloud mount answers each directory slowly enough that a deep walk runs
    /// for minutes. The budget has to end it and say so, rather than letting the
    /// UI sit there looking frozen.
    #[test]
    fn scan_gives_up_when_the_time_budget_runs_out() {
        let root = std::env::temp_dir().join(format!("printflow-budget-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        // Enough directories that a zero-length budget is certain to bite.
        let mut nested = root.clone();
        for index in 0..40 {
            nested = nested.join(format!("d{index}"));
        }
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("deep.3mf"), b"x").unwrap();

        let result = walk_slicer_files(
            &root.to_string_lossy(),
            64,
            5_000,
            std::time::Duration::from_secs(0),
            |_, _| {},
        )
        .unwrap();

        assert!(result.timed_out, "budget should have expired");
        assert!(result.truncated, "a timed-out scan is also incomplete");

        // With time to spare the same tree is walked to the bottom.
        let full = walk_slicer_files(
            &root.to_string_lossy(),
            64,
            5_000,
            std::time::Duration::from_secs(60),
            |_, _| {},
        )
        .unwrap();
        assert!(!full.timed_out);
        assert_eq!(full.files.len(), 1);
        assert!(full.folders_scanned >= 40);

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

    /// Runs the walk with a generous budget and no progress reporting.
    fn scan(root: &Path, max_depth: u32, limit: usize) -> Result<ScanResult, String> {
        walk_slicer_files(
            &root.to_string_lossy(),
            max_depth,
            limit,
            std::time::Duration::from_secs(60),
            |_, _| {},
        )
    }

    /// An absolute path that is absolute on Windows too — a literal `/home/...`
    /// is not, so the paths are derived from the platform's temp directory.
    fn absolute(name: &str) -> PathBuf {
        std::env::temp_dir().join(name)
    }

    #[test]
    fn backup_path_must_be_absolute() {
        let live = absolute("printflow.db");
        assert!(checked_backup_path("backup.db".into(), &live).is_err());
        assert!(checked_backup_path("../../etc/x.db".into(), &live).is_err());
        assert!(
            checked_backup_path(absolute("backup.db").to_string_lossy().into_owned(), &live).is_ok()
        );
    }

    #[test]
    fn backup_path_never_targets_the_live_database() {
        let live = absolute("printflow.db");
        for candidate in [
            live.clone(),
            sidecar(&live, "-wal"),
            sidecar(&live, "-shm"),
        ] {
            let as_string = candidate.to_string_lossy().into_owned();
            assert!(
                checked_backup_path(as_string.clone(), &live).is_err(),
                "should have refused `{as_string}`"
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
