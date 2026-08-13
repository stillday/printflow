-- Where a plate's file came from on disk.
--
-- Plates imported by drag & drop only ever knew a file *name*, which is not
-- enough to tell whether a file found by the library scanner is already in a
-- project: two different models are routinely called `plate_1.gcode`. The
-- absolute path is that identity.
--
-- Nullable on purpose: plates imported before this column existed, and plates
-- dropped straight onto the window (where the browser hands over no path), have
-- no meaningful value.
ALTER TABLE print_plates ADD COLUMN source_path TEXT;

CREATE INDEX IF NOT EXISTS idx_plates_source_path ON print_plates(source_path);
