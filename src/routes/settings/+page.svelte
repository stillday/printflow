<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
	import { locale, t } from 'svelte-i18n';
	import {
		Database,
		Download,
		FolderOpen,
		FolderSearch,
		Globe,
		Info,
		LayoutGrid,
		Palette,
		Upload,
		WifiOff
	} from '@lucide/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import OptionCardGroup from '$lib/components/ui/OptionCardGroup.svelte';
	import PageState from '$lib/components/ui/PageState.svelte';
	import SectionCard from '$lib/components/ui/SectionCard.svelte';
	import { closeDb } from '$lib/db';
	import {
		SETTING_LIBRARY_ROOT,
		SETTING_LOCALE,
		getDataSummary,
		setSetting,
		type DataSummary
	} from '$lib/db/settings';
	import { toasts } from '$lib/stores/toast.svelte';
	import { SUPPORTED_LOCALES, setLocale, type AppLocale } from '$lib/i18n';
	import { THEMES, type ThemePreference } from '$lib/theme';
	import { LAYOUTS, type Layout } from '$lib/layout';
	import { theme } from '$lib/stores/theme.svelte';
	import { layout } from '$lib/stores/layout.svelte';
	import { online } from '$lib/stores/online.svelte';
	import { formatNumber } from '$lib/utils/format';
	import { getSetting } from '$lib/db/settings';

	const APP_VERSION = '0.1.0';

	let summary = $state<DataSummary | null>(null);
	let dbPath = $state('');
	let loading = $state(true);
	let busy = $state(false);
	let pendingImport = $state<string | null>(null);

	async function load() {
		try {
			[summary, dbPath, libraryRoot] = await Promise.all([
				getDataSummary(),
				invoke<string>('db_file_path'),
				getSetting(SETTING_LIBRARY_ROOT)
			]);
		} catch {
			toasts.error('errors.loadFailed');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const current = $derived(($locale ?? 'de') as AppLocale);

	/** The folder the file library reads on startup. */
	let libraryRoot = $state<string | null>(null);

	async function chooseLibraryRoot() {
		try {
			const picked = await openDialog({ directory: true, multiple: false });
			if (typeof picked !== 'string') return;
			await setSetting(SETTING_LIBRARY_ROOT, picked);
			libraryRoot = picked;
			toasts.success('toast.updated');
		} catch {
			toasts.error('errors.openFailed');
		}
	}

	async function chooseOnline(enabled: boolean) {
		if (enabled === online.enabled) return;
		try {
			await online.set(enabled);
			toasts.success('toast.updated');
		} catch {
			toasts.error('errors.saveFailed');
		}
	}

	const layoutOptions = $derived(
		LAYOUTS.map((value) => ({
			value,
			label: $t(`settings.layouts.${value}`),
			hint: $t(`settings.layouts.${value}Hint`)
		}))
	);

	async function chooseLayout(next: Layout) {
		if (next === layout.current) return;
		try {
			await layout.set(next);
			toasts.success('toast.updated');
		} catch {
			toasts.error('errors.saveFailed');
		}
	}

	async function chooseTheme(next: ThemePreference) {
		if (next === theme.preference) return;
		try {
			await theme.set(next);
			toasts.success('toast.updated');
		} catch {
			// The theme already switched; only persistence failed.
			toasts.error('errors.saveFailed');
		}
	}

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

	const themeOptions = $derived(
		THEMES.map((option) => ({
			value: option,
			label: $t(`settings.themes.${option}`),
			// "System" on its own doesn't say which way it currently resolves.
			hint: option === 'system' ? $t(`settings.themes.${theme.resolved}`) : undefined
		}))
	);

	const languageOptions = $derived(
		SUPPORTED_LOCALES.map((code) => ({
			value: code,
			label: $t(`languages.${code}`),
			hint: code.toUpperCase()
		}))
	);

	// The store holds a boolean; the radio group speaks in values, so the two
	// states get names here rather than a `String(boolean)` round-trip.
	const onlineOptions = $derived([
		{ value: 'off', label: $t('settings.onlineOff'), hint: $t('settings.onlineOffHint') },
		{ value: 'on', label: $t('settings.onlineOn'), hint: $t('settings.onlineOnHint') }
	]);

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

<div class="grid max-w-3xl gap-6 page-x pb-10">
	<SectionCard icon={Palette} title={$t('settings.theme')} hint={$t('settings.themeHint')}>
		<OptionCardGroup
			options={themeOptions}
			value={theme.preference}
			label={$t('settings.theme')}
			onchange={(value) => chooseTheme(value as ThemePreference)}
		/>
	</SectionCard>

	<SectionCard icon={LayoutGrid} title={$t('settings.layout')} hint={$t('settings.layoutHint')}>
		<OptionCardGroup
			options={layoutOptions}
			value={layout.current}
			label={$t('settings.layout')}
			onchange={(value) => chooseLayout(value as Layout)}
		/>
	</SectionCard>

	<SectionCard icon={Globe} title={$t('settings.language')} hint={$t('settings.languageHint')}>
		<OptionCardGroup
			options={languageOptions}
			value={current}
			label={$t('settings.language')}
			onchange={(value) => chooseLanguage(value as AppLocale)}
		/>
	</SectionCard>

	<SectionCard icon={FolderSearch} title={$t('files.root.title')} hint={$t('files.root.hint')}>
		<div class="flex flex-wrap items-center gap-4">
			<p
				class="min-w-0 flex-1 font-mono text-xs break-all {libraryRoot
					? 'text-zinc-300'
					: 'text-zinc-400'}"
			>
				{libraryRoot ?? $t('files.root.none')}
			</p>
			<Button variant={libraryRoot ? 'secondary' : 'primary'} onclick={chooseLibraryRoot}>
				<FolderOpen size={15} />
				{libraryRoot ? $t('files.root.change') : $t('files.root.choose')}
			</Button>
		</div>
	</SectionCard>

	<SectionCard
		icon={online.enabled ? Globe : WifiOff}
		title={$t('settings.online')}
		hint={$t('settings.onlineHint')}
		tone={online.enabled ? 'amber' : 'emerald'}
	>
		<OptionCardGroup
			options={onlineOptions}
			value={online.enabled ? 'on' : 'off'}
			label={$t('settings.online')}
			columns={2}
			onchange={(value) => chooseOnline(value === 'on')}
		/>

		{#if online.enabled}
			<p class="mt-4 text-xs leading-relaxed text-zinc-400">
				{$t('settings.onlineDetail')}
			</p>
		{/if}
	</SectionCard>

	<SectionCard
		icon={Database}
		title={$t('settings.database')}
		hint={$t('settings.databaseHint')}
		tone="emerald"
	>
		<div class="grid gap-5">
			{#if loading}
				<PageState variant="loading" />
			{:else}
				{#if dbPath}
					<div>
						<span class="label-base">{$t('settings.databasePath')}</span>
						<p
							class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 font-mono text-xs break-all text-zinc-400"
						>
							{dbPath}
						</p>
					</div>
				{/if}

				{#if summaryRows.length > 0}
					<div>
						<span class="label-base">{$t('settings.dataSummary')}</span>
						<dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
							{#each summaryRows as row (row.key)}
								<div class="rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-2">
									<dt class="text-xs text-zinc-400">{$t(row.key)}</dt>
									<dd class="mt-0.5 text-sm font-semibold text-zinc-100 tabular-nums">
										{formatNumber(row.value)}
									</dd>
								</div>
							{/each}
						</dl>
					</div>
				{/if}
			{/if}

			<div class="grid gap-3 sm:grid-cols-2">
				<div class="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
					<p class="text-xs font-medium text-zinc-200">{$t('settings.export')}</p>
					<p class="mt-1 mb-3 text-xs leading-relaxed text-zinc-400">
						{$t('settings.exportHint')}
					</p>
					<Button variant="secondary" size="sm" onclick={exportBackup} disabled={busy}>
						<Download size={14} />
						{$t('settings.export')}
					</Button>
				</div>

				<div class="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
					<p class="text-xs font-medium text-zinc-200">{$t('settings.import')}</p>
					<p class="mt-1 mb-3 text-xs leading-relaxed text-zinc-400">
						{$t('settings.importHint')}
					</p>
					<Button variant="secondary" size="sm" onclick={chooseBackup} disabled={busy}>
						<Upload size={14} />
						{$t('settings.import')}
					</Button>
				</div>
			</div>
		</div>
	</SectionCard>

	<SectionCard
		icon={Info}
		title={$t('settings.about')}
		hint="{$t('app.name')} · {$t('settings.version')} {APP_VERSION}"
		tone="zinc"
	>
		<p class="text-xs leading-relaxed text-zinc-400">{$t('settings.aboutBody')}</p>
	</SectionCard>
</div>

<ConfirmDialog
	open={pendingImport !== null}
	title={$t('settings.importConfirm')}
	body={$t('settings.importConfirmBody')}
	confirmLabel={$t('settings.import')}
	onConfirm={importBackup}
	onCancel={() => (pendingImport = null)}
/>
