-- PrintFlow initial schema.
-- Weights are grams, costs are stored in the user's currency as REAL,
-- timestamps are ISO-8601 strings in UTC.

CREATE TABLE IF NOT EXISTS filament_catalog (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    brand             TEXT    NOT NULL,
    material          TEXT    NOT NULL,
    name              TEXT    NOT NULL,
    color_hex         TEXT    NOT NULL DEFAULT '#6366f1',
    density           REAL    NOT NULL DEFAULT 1.24,
    spool_tare_weight REAL    NOT NULL DEFAULT 250,
    nominal_weight    REAL    NOT NULL DEFAULT 1000,
    printing_temp_min INTEGER,
    printing_temp_max INTEGER,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spools (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    catalog_id         INTEGER NOT NULL REFERENCES filament_catalog(id) ON DELETE CASCADE,
    qr_or_bar_code     TEXT,
    current_weight_net REAL    NOT NULL DEFAULT 0,
    cost               REAL    NOT NULL DEFAULT 0,
    location           TEXT,
    status             TEXT    NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'empty', 'archived')),
    opened_at          TEXT,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    source_url  TEXT,
    status      TEXT NOT NULL DEFAULT 'planning'
                     CHECK (status IN ('planning', 'in_progress', 'completed', 'archived')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name              TEXT    NOT NULL,
    required_quantity INTEGER NOT NULL DEFAULT 1 CHECK (required_quantity >= 0),
    printed_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (printed_quantity >= 0),
    failed_quantity   INTEGER NOT NULL DEFAULT 0 CHECK (failed_quantity >= 0),
    sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS print_plates (
    id                         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id                 INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                       TEXT    NOT NULL,
    file_name                  TEXT    NOT NULL,
    estimated_time_seconds     INTEGER NOT NULL DEFAULT 0,
    layer_count                INTEGER,
    filament_requirements_json TEXT    NOT NULL DEFAULT '[]',
    parts_on_plate_json        TEXT    NOT NULL DEFAULT '[]',
    created_at                 TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS print_jobs (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    plate_id                INTEGER NOT NULL REFERENCES print_plates(id) ON DELETE CASCADE,
    spool_ids_used_json     TEXT    NOT NULL DEFAULT '[]',
    started_at              TEXT    NOT NULL,
    completed_at            TEXT,
    status                  TEXT    NOT NULL
                                    CHECK (status IN ('success', 'failed', 'cancelled')),
    actual_duration_seconds INTEGER,
    failure_reason          TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spools_catalog  ON spools(catalog_id);
CREATE INDEX IF NOT EXISTS idx_spools_status   ON spools(status);
CREATE INDEX IF NOT EXISTS idx_parts_project   ON parts(project_id);
CREATE INDEX IF NOT EXISTS idx_plates_project  ON print_plates(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_plate      ON print_jobs(plate_id);
