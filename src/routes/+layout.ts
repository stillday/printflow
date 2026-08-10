// PrintFlow is a Tauri desktop app: everything runs in the WebView against a
// local SQLite database, so there is no server rendering and nothing to
// prerender. `fallback: 'index.html'` in svelte.config.js serves the SPA shell.
export const ssr = false;
export const prerender = false;
