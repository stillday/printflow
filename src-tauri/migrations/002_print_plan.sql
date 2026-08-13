-- Print planning: which plate is meant to be printed on which day.
--
-- One row is one planned print of one plate. A plate may appear several times
-- (printing the same plate twice on different days is normal), so there is no
-- unique constraint on plate_id.
--
-- planned_date is a local calendar date as YYYY-MM-DD, not a timestamp: a plan
-- is "Tuesday", not "Tuesday 00:00 UTC". Storing it as a plain date keeps the
-- day from shifting when the user travels across a timezone.
CREATE TABLE IF NOT EXISTS print_plan_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plate_id     INTEGER NOT NULL REFERENCES print_plates(id) ON DELETE CASCADE,
    planned_date TEXT    NOT NULL,
    -- Order within a day; the queue the user intends to work through.
    position     INTEGER NOT NULL DEFAULT 0,
    status       TEXT    NOT NULL DEFAULT 'planned'
                         CHECK (status IN ('planned', 'done', 'skipped')),
    note         TEXT,
    -- Set when the plan entry was closed by logging an actual print, so the
    -- plan and the print history stay connected. Deleting the job keeps the
    -- entry, it just loses the link.
    job_id       INTEGER REFERENCES print_jobs(id) ON DELETE SET NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_date   ON print_plan_entries(planned_date);
CREATE INDEX IF NOT EXISTS idx_plan_plate  ON print_plan_entries(plate_id);
CREATE INDEX IF NOT EXISTS idx_plan_status ON print_plan_entries(status);
