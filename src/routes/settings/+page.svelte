<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
	import { locale, t } from 'svelte-i18n';
	import { Check, Database, Download, Globe, Info, Upload } from '@lucide/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { closeDb } from '$lib/db';
	import {
		SETTING_LOCALE,
		getDataSummary,
		setSetting,
		type DataSummary
	} from '$lib/db/settings';
	import { toasts } from '$lib/stores/toast.svelte';
	import { SUPPORTED_LOCALES, setLocale, type AppLocale } from '$lib/i18n';
	import { cn } from '$lib/utils/cn';
	import { formatNumber } from '$lib/utils/format';

	const APP_VERSION = '0.1.0';

	let summary = $state<DataSummary | null>(null);
	let dbPath = $state('');
	let busy = $state(false);
	let pendingImport = $state<string | null>(null);

	async function load() {
		try {
			[summary, dbPath] = await Promise.all([
				getDataSummary(),
				invoke<string>('db_file_path')
			]);
		} catch {
			toasts.error('errors.loadFailed');
		}
	}

	onMount(load);

	const current = $derived(($locale ?? 'de') as AppLocale);

	async function chooseLanguage(next: AppLocale) {
		if (next === current) return;
		setLocale(next);
		try {
			await setSetting(SETTING_LOCALE, next);
			toasts.success('toast.languageChanged');
		} catch {
			toasts.error('errors.saveFailed');
		}
	}

	async function exportBackup() {
		if (busy) return;
		busy = true;
		try {
			const target = await saveDialog({
				title: $t('settings.exportDialogTitle'),
				defaultPath: `printflow-backup-${new Date().toISOString().slice(0, 10)}.db`,
				filters: [{ name: 'SQLite', extensions: ['db', 'sqlite'] }]
			});
			if (!target) return;

			// Closing the pool checkpoints the WAL, so the copy is a complete
			// snapshot rather than a database missing its most recent writes.
			await closeDb();
			await invoke('export_database', { destination: target });
			toasts.success('toast.exported');
		} catch {
			toasts.error('errors.exportFailed');
		} finally {
			// Re-open lazily for whatever the user does next.
			await load().catch(() => undefined);
			busy = false;
		}
	}

	async function chooseBackup() {
		if (busy) return;
		try {
			const selected = await openDialog({
				title: $t('settings.importDialogTitle'),
				multiple: false,
				directory: false,
				filters: [{ name: 'SQLite', extensions: ['db', 'sqlite'] }]
			});
			if (typeof selected === 'string') pendingImport = selected;
		} catch {
			toasts.error('errors.importFailed');
		}
	}

	async function importBackup() {
		if (!pendingImport || busy) return;
		busy = true;
		const source = pendingImport;
		pendingImport = null;
		try {
			await closeDb();
			await invoke('import_database', { source });
			toasts.success('toast.imported');
			// A full reload is the cleanest way to rebuild every store and cache
			// against the newly swapped-in database file.
			setTimeout(() => window.location.reload(), 400);
		} catch {
			toasts.error('errors.importFailed');
			busy = false;
		}
	}

	const summaryRows = $derived(
		summary
			? [
					{ key: 'settings.stats.catalog', value: summary.catalog },
					{ key: 'settings.stats.spools', value: summary.spools },
					{ key: 'settings.stats.projects', value: summary.projects },
					{ key: 'settings.stats.parts', value: summary.parts },
					{ key: 'settings.stats.plates', value: summary.plates },
					{ key: 'settings.stats.jobs', value: summary.jobs }
				]
			: []
	);
</script>

<PageHeader title={$t('settings.title')} subtitle={$t('settings.subtitle')} />

<div class="grid max-w-3xl gap-6 px-8 pb-10">
	<section class="card p-6">
		<div class="flex items-center gap-3">
			<div
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-300"
			>
				<Globe size={17} />
			</div>
			<div class="min-w-0">
				<h2 class="text-sm font-semibold text-zinc-100">{$t('settings.language')}</h2>
				<p class="mt-0.5 text-xs text-zinc-400">{$t('settings.languageHint')}</p>
			</div>
		</div>

		<div class="mt-5 grid gap-2 sm:grid-cols-3">
			{#each SUPPORTED_LOCALES as code (code)}
				{@const selected = code === current}
				<button
					type="button"
					aria-pressed={selected}
					class={cn(
						'flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left text-sm transition-colors',
						selected
							? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200'
							: 'border-white/10 bg-zinc-950/40 text-zinc-300 hover:border-white/20 hover:bg-white/5'
					)}
					onclick={() => chooseLanguage(code)}
				>
					<span>
						<span class="block font-medium">{$t(`languages.${code}`)}</span>
						<span class="mt-0.5 block text-[11px] text-zinc-400 uppercase">{code}</span>
					</span>
					{#if selected}
						<Check size={16} />
					{/if}
				</button>
			{/each}
		</div>
	</section>

	<section class="card p-6">
		<div class="flex items-center gap-3">
			<div
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
			>
				<Database size={17} />
			</div>
			<div class="min-w-0">
				<h2 class="text-sm font-semibold text-zinc-100">{$t('settings.database')}</h2>
				<p class="mt-0.5 text-xs text-zinc-400">{$t('settings.databaseHint')}</p>
			</div>
		</div>

		{#if dbPath}
			<div class="mt-5">
				<span class="label-base">{$t('settings.databasePath')}</span>
				<p
					class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 font-mono text-xs break-all text-zinc-400"
				>
					{dbPath}
				</p>
			</div>
		{/if}

		{#if summaryRows.length > 0}
			<div class="mt-5">
				<span class="label-base">{$t('settings.dataSummary')}</span>
				<dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{#each summaryRows as row (row.key)}
						<div class="rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-2">
							<dt class="text-[11px] text-zinc-400">{$t(row.key)}</dt>
							<dd class="mt-0.5 text-sm font-semibold text-zinc-100 tabular-nums">
								{formatNumber(row.value)}
							</dd>
						</div>
					{/each}
				</dl>
			</div>
		{/if}

		<div class="mt-5 grid gap-3 sm:grid-cols-2">
			<div class="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
				<p class="text-xs font-medium text-zinc-200">{$t('settings.export')}</p>
				<p class="mt-1 mb-3 text-[11px] leading-relaxed text-zinc-400">
					{$t('settings.exportHint')}
				</p>
				<Button variant="secondary" size="sm" onclick={exportBackup} disabled={busy}>
					<Download size={14} />
					{$t('settings.export')}
				</Button>
			</div>

			<div class="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
				<p class="text-xs font-medium text-zinc-200">{$t('settings.import')}</p>
				<p class="mt-1 mb-3 text-[11px] leading-relaxed text-zinc-400">
					{$t('settings.importHint')}
				</p>
				<Button variant="secondary" size="sm" onclick={chooseBackup} disabled={busy}>
					<Upload size={14} />
					{$t('settings.import')}
				</Button>
			</div>
		</div>
	</section>

	<section class="card p-6">
		<div class="flex items-center gap-3">
			<div
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400"
			>
				<Info size={17} />
			</div>
			<div class="min-w-0">
				<h2 class="text-sm font-semibold text-zinc-100">{$t('settings.about')}</h2>
				<p class="mt-0.5 text-xs text-zinc-400">
					{$t('app.name')} · {$t('settings.version')}
					{APP_VERSION}
				</p>
			</div>
		</div>
		<p class="mt-4 text-xs leading-relaxed text-zinc-400">{$t('settings.aboutBody')}</p>
	</section>
</div>

<ConfirmDialog
	open={pendingImport !== null}
	title={$t('settings.importConfirm')}
	body={$t('settings.importConfirmBody')}
	confirmLabel={$t('settings.import')}
	onConfirm={importBackup}
	onCancel={() => (pendingImport = null)}
/>
