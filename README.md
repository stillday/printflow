# PrintFlow

A native, fully offline desktop app for 3D printing makers: filament spool
inventory, multi-part assembly (BOM) planning, print scheduling, and `.3mf` /
G-code metadata parsing with automatic stock deduction.

Available in **German**, **English** and **Dutch**, in a dark and a light
theme.

---

## What it does

| Area | Summary |
| --- | --- |
| **Filament catalog** (`/catalog`) | Filament types with brand, material, colour, density, empty-spool (tare) weight and printing temperatures. |
| **Spool inventory** (`/spools`) | Per-spool net weight with fill rings, storage locations, barcodes, cost, and a tare calculator (`net = scale − tare`). Filter by status, material and location. |
| **Project BOM** (`/projects`) | Multi-part assemblies with required / printed / failed counters, inline `+`/`−` adjustment and overall progress. |
| **Plate import** (`/projects/[id]`) | Drag & drop a `.3mf` or `.gcode` file: print time, layer count and per-slot filament usage are read out, and the objects on the plate are mapped to (or turned into) BOM parts. |
| **Print plan** (`/plan`) | A weekly agenda of what gets printed when: per-day print time with a warning above 24 h, the week's filament need per material, and a separate section for overdue entries. Schedule one plate or a batch, optionally spread over following days. Logging a print from here closes its plan entry. |
| **File library** (`/files`) | Point PrintFlow at the folder your models live in; it walks it for `.3mf` and G-code, groups the hits by folder, marks what is already imported and imports the rest into a project. |
| **Print logging** | Assign a spool per AMS/MMU slot, see needed vs. available vs. remaining, then log the print as successful, failed or cancelled. Stock and part counters update in one atomic transaction. |
| **Settings** (`/settings`) | Appearance (dark / light / system), language switch, online features (off by default), database location, and backup export / import. |

---

## Tech stack

- **[Tauri v2](https://tauri.app)** — native shell (Rust), ~10 MB installers
- **[SvelteKit](https://svelte.dev) + Svelte 5** — SPA via `adapter-static`
- **[Tailwind CSS v4](https://tailwindcss.com)** + [Lucide](https://lucide.dev) icons
- **SQLite** via `@tauri-apps/plugin-sql`, stored in the OS app-config directory
- **[svelte-i18n](https://github.com/kaisermann/svelte-i18n)** — `de` / `en` / `nl`
- **[JSZip](https://stuk.github.io/jszip/)** — client-side `.3mf` unpacking
- TypeScript in strict mode

**The WebView never reaches the network.** The Content-Security-Policy in
`src-tauri/tauri.conf.json` restricts it to `'self'` plus the Tauri IPC channel,
so the interface cannot phone home even by accident.

Two optional features do use the network, and they are **off by default** and run
in Rust rather than in the WebView, which is why the policy above stays closed:
fetching a project's preview image once from its model page (it is then stored
locally and rendered from a `data:` URI), and downloading a file from a link you
supply. Both are restricted to a fixed list of model portals, https-only, size-
capped and time-limited — see `fetch_model_preview` and `download_file` in
`src-tauri/src/lib.rs`. With the switch off, nothing in the app opens a socket.

---

## Getting started

Requirements: Node 22+, Rust 1.77+, and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri:dev      # dev app with hot reload
```

Other scripts:

```bash
npm run check          # svelte-check (TypeScript + Svelte)
npm test               # vitest — slicer file parser test suite
npm run build          # frontend only, into build/
npm run tauri:build    # production installer for the current platform

cd src-tauri && cargo test    # Rust side: link and backup-path validation
```

---

## Project layout

```
src/
  lib/
    bootstrap.ts            startup: i18n -> database -> stored theme + locale
    db/                     one module per entity, snake_case <-> camelCase mapping
      index.ts              connection, transaction() helper
      catalog.ts spools.ts projects.ts parts.ts plates.ts jobs.ts
      settings.ts search.ts
    i18n/
      index.ts              locale detection + setup
      locales/              de.json · en.json · nl.json
    types/schema.ts         domain types mirroring the SQL schema
    theme.ts                dark/light preference, applied to <html>
    utils/
      threemf.ts            .3mf / G-code metadata parser
      plan.ts               calendar maths for the print plan
      library.ts            grouping and filtering for the file library
      format.ts color.ts status.ts validate.ts cn.ts
    components/
      ui/ layout/ catalog/ spools/ projects/
  routes/                   /, /spools, /catalog, /projects, /projects/[id],
                            /plan, /files, /settings

src-tauri/
  src/lib.rs                plugins, backup + transaction commands, the slicer
                            file scanner, and the two model-portal commands
  migrations/                001_initial · 002_print_plan · 003_plate_source_path
                             004_project_previews · 005_job_parts
  tauri.conf.json           window, CSP and bundle configuration
  capabilities/default.json permissions granted to the main window
```

### Where the data lives

A single SQLite file in the OS app-config directory, shown in **Settings**:

| OS | Path |
| --- | --- |
| Linux | `~/.config/app.printflow.desktop/printflow.db` |
| macOS | `~/Library/Application Support/app.printflow.desktop/printflow.db` |
| Windows | `%APPDATA%\app.printflow.desktop\printflow.db` |

Schema changes go into a **new** numbered file under `src-tauri/migrations/`,
registered in `migrations()` in `src-tauri/src/lib.rs`. Never edit an applied
migration — `tauri-plugin-sql` tracks them by version and checksum.

---

## Notes on a few design decisions

**Transactions run in Rust.** `tauri-plugin-sql` hands out *pooled* connections,
so `BEGIN` / `COMMIT` issued as separate `execute()` calls from the frontend can
land on different connections and silently fail to be atomic. The
`db_transaction` command in `src-tauri/src/lib.rs` borrows the plugin's own pool
and uses a real `sqlx` transaction. Logging a print — which writes the job,
deducts filament from several spools and bumps part counters — goes through it,
so stock can never drift out of step with the counters.

**External links leave the WebView.** The app runs in one WebView with no
browser chrome, so a `target="_blank"` link to a model page would replace the UI
with no way back. Model links go through the `open_external` command, which
accepts `http`/`https` only and hands the URL to the OS browser; the
`navigation-guard` plugin cancels any navigation that is not the app's own
origin. A `sourceUrl` is re-validated when it is rendered, not just when it is
entered — a restored backup has never passed the input check.

**Theming runs through CSS variables, not `dark:` variants.** The UI is written
entirely in Tailwind's zinc ramp plus a few accent shades, and Tailwind v4
compiles each of those to a `var(--color-…)` reference. The light theme therefore
redefines those variables under `:root[data-theme='light']` in `app.css`, which
re-themes all ~350 colour utilities at once. The zinc ramp is inverted,
`--color-white` flips to near-black so the `border-white/10` hairlines stay
visible, and `--color-on-accent` stays white in both themes so a primary button's
label does not invert with it.

**Drag & drop is handled by the WebView.** `dragDropEnabled: false` in the window
config turns off Tauri's native file-drop interception, so HTML5 drag & drop
yields real `File` objects that JSZip can read directly — no filesystem
permissions needed. Plain `.gcode` files are only read in 512 KB slices from the
head and tail of the file, where slicers put their metadata, so a 200 MB G-code
file costs about 1 MB of memory.

---

## Supported slicer files

| Input | Read from |
| --- | --- |
| `.3mf` from Bambu Studio / OrcaSlicer | `Metadata/slice_info.config` — exact per-plate time, layer count, and per-slot filament type, colour, length and weight |
| `.gcode.3mf` | the embedded G-code header, one plate per `plate_N.gcode` |
| Bambu / Orca `.3mf` **saved without slicing** | `Metadata/model_settings.config` — object names and the per-plate layout. Its `slice_info.config` exists but is empty, and `3D/3dmodel.model` carries no names at all, so this is the only place the real part names live |
| `.3mf` project without slice data (e.g. PrusaSlicer) | `3D/3dmodel.model` — object names and instance counts, so the BOM can still be built |
| `.gcode` from PrusaSlicer, OrcaSlicer, Bambu Studio, Cura | time, layer count, per-extruder filament weight/length/type/colour, and object names |

Unreadable or non-standard files surface a translated message and never crash
the app.

---

## Releasing

Push a tag and the `Release` workflow builds `.msi` + `.exe` (Windows), `.dmg`
(macOS Intel and Apple silicon) and `.AppImage` + `.deb` (Linux) and publishes
them as a GitHub release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Keep the version in `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` in sync with the tag.

> **Local AppImage builds fail on rolling-release distros.** The prebuilt
> `linuxdeploy` ships an old `strip` that rejects the `.relr.dyn` sections
> produced by current toolchains (Arch, CachyOS, Fedora Rawhide), so
> `npm run tauri:build` aborts at the AppImage step. Build `.deb` locally with
> `npm run tauri:build -- --bundles deb`; the release workflow runs on
> `ubuntu-latest`, where the AppImage step works.
