<script lang="ts">
	import { onMount } from 'svelte';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { t } from 'svelte-i18n';
	import {
		Check,
		ChevronDown,
		ChevronRight,
		FolderOpen,
		FolderSearch,
		HardDriveDownload,
		RefreshCw,
		TriangleAlert
	} from '@lucide/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import PlateImportModal from '$lib/components/projects/PlateImportModal.svelte';
	import ChooseProjectModal from '$lib/components/library/ChooseProjectModal.svelte';
	import { readSlicerFile, scanSlicerFiles, type ScannedFile } from '$lib/db/library';
	import { listImportedPaths } from '$lib/db/plates';
	import { listParts } from '$lib/db/parts';
	import { SETTING_LIBRARY_ROOT, getSetting, setSetting } from '$lib/db/settings';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { Part } from '$lib/types/schema';
	import { formatBytes, formatDate } from '$lib/utils/format';
	import { filterFiles, groupByFolder, suggestProjectName } from '$lib/utils/library';
	import { parsePrintFile, type ParseResult } from '$lib/utils/threemf';
	import { cn } from '$lib/utils/cn';

	let root = $state<string | null>(null);
	let files = $state<ScannedFile[]>([]);
	let imported = $state<Set<string>>(new Set());
	let truncated = $state(false);
	let scanning = $state(false);
	let search = $state('');
	let collapsed = $state<Set<string>>(new Set());

	/** The file waiting for a project to be picked. */
	let choosing = $state<ScannedFile | null>(null);
	/** Everything the plate importer needs once a project is settled. */
	let importing = $state<{
		projectId: number;
		result: ParseResult;
		parts: Part[];
		sourcePath: string;
	} | null>(null);

	const visible = $derived(filterFiles(files, search));
	const groups = $derived(groupByFolder(visible, imported));
	const totalBytes = $derived(visible.reduce((sum, file) => sum + Math.max(0, file.sizeBytes), 0));

	onMount(async () => {
		// Remember the library folder — nobody wants to re-pick it every time.
		try {
			const stored = await getSetting(SETTING_LIBRARY_ROOT);
			if (stored) {
				root = stored;
				await scan();
			}
		} catch {
			toasts.error('errors.loadFailed');
		}
	});

	async function chooseFolder() {
		const picked = await openDialog({ directory: true, multiple: false });
		if (typeof picked !== 'string') return;
		root = picked;
		try {
			await setSetting(SETTING_LIBRARY_ROOT, picked);
		} catch {
			// Not fatal — the scan below still works this session.
		}
		await scan();
	}

	async function scan() {
		if (!root || scanning) return;
		scanning = true;
		try {
			const [result, importedPaths] = await Promise.all([
				scanSlicerFiles(root),
				listImportedPaths()
			]);
			files = result.files;
			truncated = result.truncated;
			imported = importedPaths;
			if (result.files.length === 0) toasts.push('files.noneFound', 'info');
		} catch (error) {
			toasts.error('files.scanFailed', {
				reason: error instanceof Error ? error.message : String(error)
			});
		} finally {
			scanning = false;
		}
	}

	function toggle(folder: string) {
		const next = new Set(collapsed);
		if (next.has(folder)) next.delete(folder);
		else next.add(folder);
		collapsed = next;
	}

	/** Reads and parses the file once a project has been settled on. */
	async function startImport(file: ScannedFile, projectId: number) {
		try {
			const [handle, parts] = await Promise.all([
				readSlicerFile(file.path, file.fileName),
				listParts(projectId)
			]);
			const result = await parsePrintFile(handle);
			importing = { projectId, result, parts, sourcePath: file.path };
		} catch (error) {
			// ParseError carries an i18n key; anything else is a read failure.
			const key = error && typeof error === 'object' && 'key' in error ? String(error.key) : null;
			toasts.error(key ?? 'files.readFailed');
		}
	}

	async function afterImport() {
		importing = null;
		toasts.success('toast.plateAdded');
		// Re-read which paths are taken so the badges update.
		try {
			imported = await listImportedPaths();
		} catch {
			// The badge is cosmetic; a failure here is not worth a toast.
		}
	}
</script>

<PageHeader title={$t('files.title')} subtitle={$t('files.subtitle')}>
	{#snippet actions()}
		{#if root}
			<Button variant="secondary" onclick={scan} disabled={scanning}>
				<RefreshCw size={15} class={scanning ? 'animate-spin' : undefined} />
				{$t('files.rescan')}
			</Button>
		{/if}
		<Button variant={root ? 'secondary' : 'primary'} onclick={chooseFolder} disabled={scanning}>
			<FolderOpen size={15} />
			{$t('files.chooseFolder')}
		</Button>
	{/snippet}
</PageHeader>

<div class="px-8 pb-10">
	{#if !root}
		<div class="card">
			<EmptyState icon={FolderSearch} title={$t('files.empty')} body={$t('files.emptyBody')}>
				{#snippet action()}
					<Button variant="primary" onclick={chooseFolder}>
						<FolderOpen size={16} />
						{$t('files.chooseFolder')}
					</Button>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<div class="card mb-5 px-5 py-4">
			<p class="font-mono text-[11px] break-all text-zinc-400">{root}</p>
			<div class="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
				<p class="text-sm font-semibold text-zinc-100 tabular-nums">
					{$t('files.fileCount', { values: { count: visible.length } })}
					<span class="ml-1 text-xs font-normal text-zinc-400">{formatBytes(totalBytes)}</span>
				</p>
				<input
					class="input-base ml-auto max-w-xs"
					type="search"
					bind:value={search}
					placeholder={$t('files.searchPlaceholder')}
					aria-label={$t('common.search')}
				/>
			</div>

			{#if truncated}
				<p class="mt-3 inline-flex items-center gap-2 text-[11px] text-amber-300">
					<TriangleAlert size={13} />
					{$t('files.truncated')}
				</p>
			{/if}
		</div>

		{#if scanning && files.length === 0}
			<p class="py-16 text-center text-sm text-zinc-400">{$t('files.scanning')}</p>
		{:else if groups.length === 0}
			<div class="card">
				<EmptyState
					icon={FolderSearch}
					title={$t('common.noResults')}
					body={$t('common.noResultsHint')}
				/>
			</div>
		{:else}
			<div class="grid gap-3">
				{#each groups as group (group.folder)}
					{@const isCollapsed = collapsed.has(group.folder)}
					<section class="card overflow-hidden">
						<button
							type="button"
							class="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-white/5"
							aria-expanded={!isCollapsed}
							onclick={() => toggle(group.folder)}
						>
							{#if isCollapsed}
								<ChevronRight size={15} class="shrink-0 text-zinc-400" />
							{:else}
								<ChevronDown size={15} class="shrink-0 text-zinc-400" />
							{/if}

							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium text-zinc-100">
									{#if group.segments.length === 0}
										{$t('files.rootFolder')}
									{:else}
										{group.segments.join(' / ')}
									{/if}
								</span>
								<span class="mt-0.5 block text-[11px] text-zinc-400 tabular-nums">
									{$t('files.fileCount', { values: { count: group.files.length } })}
									· {formatBytes(group.totalBytes)}
								</span>
							</span>

							{#if group.importedCount > 0}
								<span
									class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 tabular-nums"
								>
									<Check size={12} />
									{group.importedCount}/{group.files.length}
								</span>
							{/if}
						</button>

						{#if !isCollapsed}
							<ul class="divide-y divide-white/5 border-t border-white/10">
								{#each group.files as file (file.path)}
									{@const alreadyImported = imported.has(file.path)}
									<li class="flex flex-wrap items-center gap-3 px-5 py-3">
										<div class="min-w-0 flex-1">
											<p
												class={cn(
													'truncate text-sm',
													alreadyImported ? 'text-zinc-400' : 'text-zinc-100'
												)}
											>
												{file.fileName}
											</p>
											<p class="mt-0.5 text-[11px] text-zinc-400 tabular-nums">
												{formatBytes(file.sizeBytes)}
												{#if file.modifiedAt}
													· {formatDate(new Date(file.modifiedAt * 1000).toISOString())}
												{/if}
											</p>
										</div>

										{#if alreadyImported}
											<span
												class="inline-flex items-center gap-1.5 text-[11px] text-emerald-300"
												title={$t('files.alreadyImportedHint')}
											>
												<Check size={13} />
												{$t('files.alreadyImported')}
											</span>
										{:else}
											<Button variant="secondary" size="sm" onclick={() => (choosing = file)}>
												<HardDriveDownload size={13} />
												{$t('files.import')}
											</Button>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<ChooseProjectModal
	file={choosing}
	suggestedName={choosing ? suggestProjectName(choosing) : ''}
	onClose={() => (choosing = null)}
	onChosen={(projectId) => {
		const file = choosing;
		choosing = null;
		if (file) void startImport(file, projectId);
	}}
/>

{#if importing}
	<PlateImportModal
		projectId={importing.projectId}
		result={importing.result}
		parts={importing.parts}
		sourcePath={importing.sourcePath}
		onClose={() => (importing = null)}
		onImported={afterImport}
	/>
{/if}
