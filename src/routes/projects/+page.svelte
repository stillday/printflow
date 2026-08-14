<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto, replaceState } from '$app/navigation';
	import { t } from 'svelte-i18n';
	import { ExternalLink, FolderKanban, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ProgressBar from '$lib/components/ui/ProgressBar.svelte';
	import StatusPill from '$lib/components/ui/StatusPill.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import ProjectModal from '$lib/components/projects/ProjectModal.svelte';
	import { deleteProject, listProjects } from '$lib/db/projects';
	import { toasts } from '$lib/stores/toast.svelte';
	import {
		PROJECT_STATUSES,
		type Project,
		type ProjectStatus,
		type ProjectWithProgress
	} from '$lib/types/schema';
	import { formatDate, formatPercent } from '$lib/utils/format';
	import { projectTone } from '$lib/utils/status';
	import { isExternalUrl, openExternal } from '$lib/utils/external';

	/** Anything else in `?status=` (hand-typed, stale link) would filter the list empty. */
	function readStatus(raw: string | null): 'all' | ProjectStatus {
		return PROJECT_STATUSES.includes(raw as ProjectStatus) ? (raw as ProjectStatus) : 'all';
	}

	let projects = $state<ProjectWithProgress[]>([]);
	let loading = $state(true);
	// Search and status filter live in the URL, so opening a project and coming
	// back — or reloading — restores the list the user was actually looking at.
	let search = $state(page.url.searchParams.get('q') ?? '');
	let statusFilter = $state<'all' | ProjectStatus>(readStatus(page.url.searchParams.get('status')));

	let modalOpen = $state(false);
	let editing = $state<Project | null>(null);
	let pendingDelete = $state<ProjectWithProgress | null>(null);

	async function load() {
		try {
			projects = await listProjects();
		} catch {
			toasts.error('errors.loadFailed');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	// Mirrors the two filters back into the URL without adding history entries —
	// `Back` should leave the list, not undo keystrokes. An unused filter writes
	// no parameter at all, so an untouched list keeps a clean `/projects`.
	const LIST_PATH = '/projects';
	$effect(() => {
		// Never rewrite someone else's URL: on the way to a project detail page the
		// path can already have changed while this component is still alive.
		if (page.url.pathname !== LIST_PATH) return;

		const params = new URLSearchParams();
		const term = search.trim();
		if (term) params.set('q', term);
		if (statusFilter !== 'all') params.set('status', statusFilter);

		const query = params.toString();
		const next = query ? `?${query}` : '';
		if (next !== page.url.search) replaceState(`${LIST_PATH}${next}`, page.state);
	});

	function resetFilters() {
		search = '';
		statusFilter = 'all';
	}

	const filtersActive = $derived(search.trim() !== '' || statusFilter !== 'all');

	const filtered = $derived.by(() => {
		const term = search.trim().toLowerCase();
		return projects.filter((project) => {
			if (statusFilter !== 'all' && project.status !== statusFilter) return false;
			if (!term) return true;
			return `${project.title} ${project.description ?? ''}`.toLowerCase().includes(term);
		});
	});

	function progressOf(project: ProjectWithProgress): number {
		return project.requiredTotal > 0
			? Math.min(1, project.printedTotal / project.requiredTotal)
			: 0;
	}

	function openCreate() {
		editing = null;
		modalOpen = true;
	}

	/** Hands the model link to the OS browser — see `utils/external.ts`. */
	async function openSource(url: string) {
		try {
			await openExternal(url);
		} catch {
			toasts.error('errors.openFailed');
		}
	}

	function openEdit(project: ProjectWithProgress) {
		editing = project;
		modalOpen = true;
	}

	async function confirmDelete() {
		if (!pendingDelete?.id) return;
		try {
			await deleteProject(pendingDelete.id);
			toasts.success('toast.deleted');
			await load();
		} catch {
			toasts.error('errors.deleteFailed');
		} finally {
			pendingDelete = null;
		}
	}

	function onSaved(id: number) {
		// A freshly created project goes straight to its detail page, where the
		// parts and plates actually live.
		if (editing) {
			load();
		} else {
			goto(`/projects/${id}`);
		}
	}
</script>

<PageHeader title={$t('projects.title')} subtitle={$t('projects.subtitle')}>
	{#snippet actions()}
		<Button variant="primary" onclick={openCreate}>
			<Plus size={16} />
			{$t('projects.add')}
		</Button>
	{/snippet}
</PageHeader>

<div class="page-x pb-10">
	{#if loading}
		<p class="py-16 text-center text-sm text-zinc-400">{$t('common.loading')}</p>
	{:else if projects.length === 0}
		<div class="card">
			<EmptyState icon={FolderKanban} title={$t('projects.empty')} body={$t('projects.emptyBody')}>
				{#snippet action()}
					<Button variant="primary" onclick={openCreate}>
						<Plus size={16} />
						{$t('projects.add')}
					</Button>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<div class="mb-5 flex flex-wrap items-end gap-3">
			<div class="w-full max-w-xs">
				<!--
					Both controls carry a real `<label for>`: the status select used to be
					captioned by a bare `<span>`, which is not associated with anything and
					left the select without an accessible name.
				-->
				<label class="label-base" for="project-search">{$t('common.search')}</label>
				<input
					id="project-search"
					class="input-base"
					type="search"
					bind:value={search}
					placeholder={$t('common.searchPlaceholder')}
				/>
			</div>
			<div>
				<label class="label-base" for="project-status">{$t('projects.filterStatus')}</label>
				<select id="project-status" class="input-base w-44" bind:value={statusFilter}>
					<option value="all">{$t('common.all')}</option>
					{#each PROJECT_STATUSES as value (value)}
						<option {value}>{$t(`status.${value}`)}</option>
					{/each}
				</select>
			</div>

			<div class="ml-auto flex items-center gap-3">
				<!-- Filtering changed the list silently; the count says by how much. -->
				<p class="text-xs text-zinc-400 tabular-nums" aria-live="polite">
					{$t('projects.countOf', {
						values: { shown: filtered.length, total: projects.length }
					})}
				</p>
				{#if filtersActive}
					<Button variant="ghost" size="sm" onclick={resetFilters}>{$t('common.reset')}</Button>
				{/if}
			</div>
		</div>

		{#if filtered.length === 0}
			<div class="card">
				<EmptyState
					icon={FolderKanban}
					title={$t('common.noResults')}
					body={$t('common.noResultsHint')}
				>
					{#snippet action()}
						<!-- The filters survive in the URL now, so a stale one needs a way out. -->
						<Button onclick={resetFilters}>{$t('common.reset')}</Button>
					{/snippet}
				</EmptyState>
			</div>
		{:else}
			<ul class="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
				{#each filtered as project (project.id)}
					{@const ratio = progressOf(project)}
					<li class="card group relative flex flex-col p-5 transition-colors duration-200 hover:border-indigo-500/40 hover:bg-white/[0.04]">
						<div class="flex items-start justify-between gap-3">
							<!--
								Stretched link: the whole card is the target, which is what its
								hover state promises. The action row below opts back out with
								`relative z-10`. No aria-label here — it would override the title
								and a screen reader would hear "open project" for every card
								instead of the project's name.
							-->
							<a
								href="/projects/{project.id}"
								class="min-w-0 flex-1 rounded-lg outline-offset-4 after:absolute after:inset-0 after:content-['']"
							>
								<p class="truncate text-sm font-semibold text-zinc-100 group-hover:text-indigo-200">
									{project.title}
								</p>
								<!-- A bare date told nobody what it dates. -->
								<p class="mt-0.5 truncate text-xs text-zinc-400">
									{$t('projects.updatedAt', { values: { date: formatDate(project.updatedAt) } })}
								</p>
							</a>
							<StatusPill labelKey="status.{project.status}" tone={projectTone(project.status)} />
						</div>

						{#if project.description}
							<p class="mt-3 line-clamp-2 text-xs leading-relaxed text-zinc-400">
								{project.description}
							</p>
						{/if}

						<div class="mt-auto pt-5">
							<div class="mb-2 flex items-baseline justify-between gap-2 text-xs">
								<span class="text-zinc-400">{$t('projects.progress')}</span>
								<span class="font-semibold text-zinc-300 tabular-nums">
									{formatPercent(ratio)}
								</span>
							</div>
							<ProgressBar
								value={ratio}
								secondary={project.requiredTotal > 0
									? project.failedTotal / project.requiredTotal
									: 0}
								tone={ratio >= 1 ? 'emerald' : 'indigo'}
							/>
							<p class="mt-2 text-xs text-zinc-400">
								{$t('projects.partsProgress', {
									values: { printed: project.printedTotal, required: project.requiredTotal }
								})}
							</p>
						</div>

						<div
							class="relative z-10 mt-4 flex items-center justify-end gap-1 border-t border-white/5 pt-3 opacity-85 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
						>
							{#if isExternalUrl(project.sourceUrl)}
								<IconButton
									label={$t('projects.openSource')}
									onclick={() => openSource(project.sourceUrl!)}
								>
									<ExternalLink size={15} />
								</IconButton>
							{/if}
							<IconButton label={$t('common.edit')} onclick={() => openEdit(project)}>
								<Pencil size={15} />
							</IconButton>
							<IconButton
								label={$t('common.delete')}
								tone="danger"
								onclick={() => (pendingDelete = project)}
							>
								<Trash2 size={15} />
							</IconButton>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<ProjectModal
	open={modalOpen}
	project={editing}
	onClose={() => (modalOpen = false)}
	{onSaved}
/>

<ConfirmDialog
	open={pendingDelete !== null}
	title={$t('projects.deleteConfirm', { values: { title: pendingDelete?.title ?? '' } })}
	body={$t('projects.deleteBody')}
	onConfirm={confirmDelete}
	onCancel={() => (pendingDelete = null)}
/>
