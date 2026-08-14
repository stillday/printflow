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
		Loader,
		RefreshCw,
		TriangleAlert
	} from '@lucide/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import PlateImportModal from '$lib/components/projects/PlateImportModal.svelte';
	import ChooseProjectModal from '$lib/components/library/ChooseProjectModal.svelte';
	import {
		onScanProgress,
		readSlicerFile,
		scanSlicerFiles,
		type ScannedFile
	} from '$lib/db/library';
	import { listImportedPaths, type ImportedPlate } from '$lib/db/plates';
	import { listParts } from '$lib/db/parts';
	import { SETTING_LIBRARY_ROOT, getSetting, setSetting } from '$lib/db/settings';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { Part } from '$lib/types/schema';
	import { formatBytes, formatDate } from '$lib/utils/format';
	import { filterFiles, groupByFolder, suggestProjectName } from '$lib/utils/library';
	import { analyseLibrary } from '$lib/utils/libraryShape';
	import { parsePrintFile, type ParseResult } from '$lib/utils/threemf';
	import { cn } from '$lib/utils/cn';

	let root = $state<string | null>(null);
	let files = $state<ScannedFile[]>([]);
	/** Path → the project the file already sits in, so a row can link there. */
	let imported = $state<Map<string, ImportedPlate>>(new Map());
	let truncated = $state(false);
	let timedOut = $state(false);
	let scanning = $state(false);
	/** Live counts while the walk runs, so a slow folder never looks frozen. */
	let progress = $state<{ folders: number; files: number } | null>(null);
	let search = $state('');
	let collapsed = $state<Set<string>>(new Set());

	/** The file waiting for a project to be picked. */
	let choosing = $state<ScannedFile | null>(null);
	/** The file being read and parsed — seconds of work on a big plate. */
	let preparing = $state<ScannedFile | null>(null);
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

	/**
	 * How the library is already arranged. Read from the *whole* scan, not the
	 * filtered view — the arrangement is a property of the folder, and typing in
	 * the search box must not appear to change it.
	 */
	const shape = $derived(analyseLibrary(files));

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
		let picked: string | string[] | null;
		try {
			picked = await openDialog({ directory: true, multiple: false });
		} catch {
			// The native picker is a separate service on Linux (xdg-desktop-portal);
			// without it the call rejects and the button would do nothing at all.
			toasts.error('files.folderDialogFailed');
			return;
		}
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
		progress = { folders: 0, files: 0 };
		const unlisten = await onScanProgress((event) => {
			progress = { folders: event.foldersScanned, files: event.filesFound };
		});
		try {
			const [result, importedPaths] = await Promise.all([
				scanSlicerFiles(root),
				listImportedPaths()
			]);
			files = result.files;
			truncated = result.truncated;
			timedOut = result.timedOut;
			imported = importedPaths;
			// No toast for an empty result — the list itself says so, and stays.
		} catch (error) {
			toasts.error('files.scanFailed', {
				reason: error instanceof Error ? error.message : String(error)
			});
		} finally {
			unlisten();
			scanning = false;
			progress = null;
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
		preparing = file;
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
		} finally {
			preparing = null;
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

			<!--
				What the folder's own structure is, said out loud: a user who spent
				years arranging folders should not have to explain that arrangement,
				and it decides whether we can suggest project names at all.
			-->
			{#if shape.shape !== 'empty' && !scanning}
				<p class="mt-3 text-[11px] leading-relaxed text-zinc-400">
					<span class="font-medium text-zinc-300">{$t('files.shape.title')}:</span>
					{$t(`files.shape.${shape.shape}`, {
						values: {
							folders: shape.folderCount,
							perFolder: shape.medianFilesPerFolder,
							depth: shape.maxDepth,
							categories: shape.categories.slice(0, 4).join(', ')
						}
					})}
				</p>
			{/if}

			{#if timedOut}
				<p class="mt-3 flex items-start gap-2 text-[11px] text-amber-300">
					<TriangleAlert size={13} class="mt-0.5 shrink-0" />
					<span>{$t('files.timedOut')}</span>
				</p>
			{:else if truncated}
				<p class="mt-3 inline-flex items-center gap-2 text-[11px] text-amber-300">
					<TriangleAlert size={13} />
					{$t('files.truncated')}
				</p>
			{/if}
		</div>

		<!--
			Shown on every scan, not just the first: a rescan of a network folder can
			run for half a minute, and the list underneath is last scan's, not this
			one's — the counter is the only sign anything is happening.
		-->
		{#if scanning}
			<div class="card mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5">
				<Loader size={15} class="shrink-0 animate-spin text-zinc-400" />
				<p class="text-sm text-zinc-300">{$t('files.scanning')}</p>
				{#if progress}
					<p class="ml-auto text-[11px] text-zinc-400 tabular-nums">
						{$t('files.progress', {
							values: { folders: progress.folders, files: progress.files }
						})}
					</p>
				{/if}
			</div>
		{/if}

		{#if groups.length === 0 && !scanning}
			<div class="card">
				{#if search !== ''}
					<EmptyState
						icon={FolderSearch}
						title={$t('common.noResults')}
						body={$t('common.noResultsHint')}
					/>
				{:else}
					<!-- Nothing in the folder at all: a filter hint would be wrong advice. -->
					<EmptyState
						icon={FolderSearch}
						title={$t('files.noneFoundTitle')}
						body={$t('files.noneFound')}
					>
						{#snippet action()}
							<Button variant="primary" onclick={chooseFolder}>
								<FolderOpen size={16} />
								{$t('files.chooseOtherFolder')}
							</Button>
						{/snippet}
					</EmptyState>
				{/if}
			</div>
		{:else if groups.length > 0}
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
									{@const inProject = imported.get(file.path)}
									<li class="flex flex-wrap items-center gap-3 px-5 py-3">
										<div class="min-w-0 flex-1">
											<p
												class={cn('truncate text-sm', inProject ? 'text-zinc-400' : 'text-zinc-100')}
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

										{#if inProject}
											<!-- "Imported" alone left the user stuck; the project is the way out. -->
											<a
												href="/projects/{inProject.projectId}"
												class="inline-flex max-w-[14rem] items-center gap-1.5 text-[11px] text-emerald-300 transition-colors hover:text-emerald-200"
												title={$t('files.alreadyImportedIn', {
													values: { project: inProject.projectTitle }
												})}
											>
												<Check size={13} class="shrink-0" />
												<span class="shrink-0">{$t('files.alreadyImported')}</span>
												<span class="truncate text-zinc-400">· {inProject.projectTitle}</span>
											</a>
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

<!--
	Reading and parsing a multi-megabyte plate takes seconds, and it happens after
	the project dialog has closed — without this the app just sits there.
-->
{#if preparing}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
		role="status"
		aria-live="polite"
	>
		<div class="card flex max-w-sm items-center gap-3 px-6 py-5">
			<Loader size={18} class="shrink-0 animate-spin text-indigo-300" />
			<div class="min-w-0">
				<p class="text-sm font-medium text-zinc-100">{$t('files.preparingImport')}</p>
				<p class="mt-0.5 truncate text-[11px] text-zinc-400">{preparing.fileName}</p>
			</div>
		</div>
	</div>
{/if}

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
