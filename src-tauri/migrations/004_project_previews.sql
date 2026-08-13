-- Locally stored preview image for a project.
--
-- A separate table rather than columns on `projects` on purpose: a base64 image
-- is easily a few hundred kilobytes, and the project list selects whole rows
-- with aggregates. Keeping the image out of that row means listing projects
-- never drags the pictures along.
--
-- One row per project (hence the primary key on project_id): a project shows one
-- preview. The image is fetched once from the model page and then belongs to the
-- database, so the app keeps showing it with no network.
CREATE TABLE IF NOT EXISTS project_previews (
    project_id   INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    -- The image itself, base64. Rendered through a `data:` URI, which the
    -- Content-Security-Policy already allows — no file paths, no asset server.
    image_base64 TEXT    NOT NULL,
    content_type TEXT    NOT NULL DEFAULT 'image/jpeg',
    -- Where it came from, so provenance is visible and a refetch is possible.
    image_url    TEXT,
    source_url   TEXT,
    fetched_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
