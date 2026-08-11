<script lang="ts">
		import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { t } from 'svelte-i18n';
	import { ArrowLeft, ExternalLink, History, Layers3, Pencil, Trash2 } from '@lucide/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusPill from '$lib/components/ui/StatusPill.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import ProjectModal from '$lib/components/projects/ProjectModal.svelte';
	import PartsPanel from '$lib/components/projects/PartsPanel.svelte';
	import PlateDropzone from '$lib/components/projects/PlateDropzone.svelte';
	import PlateImportModal from '$lib/components/projects/PlateImportModal.svelte';
	import PlateCard from '$lib/components/projects/PlateCard.svelte';
	import AssignPartsModal from '$lib/components/projects/AssignPartsModal.svelte';
	import PrintJobModal from '$lib/components/projects/PrintJobModal.svelte';
	import { deleteProject, getProject } from '$lib/db/projects';
	import { listParts } from '$lib/db/parts';
	import { deletePlate, listPlates } from '$lib/db/plates';
	import { deleteJob, listJobsForProject } from '$lib/db/jobs';
	import { listSpools } from '$lib/db/spools';
	import { toasts } from '$lib/stores/toast.svelte';
	import type {
		Part,
		PrintJobDecoded,
		PrintPlateDecoded,
		Project,
		SpoolWithCatalog
	} from '$lib/types/schema';
	import type { ParseResult } from '$lib/utils/threemf';
	import { formatDateTime, formatDuration, formatGrams } from '$lib/utils/format';
	import { jobTone, projectTone } from '$lib/utils/status';
	import { cn } from '$lib/utils/cn';

	type Tab = 'parts' | 'plates' | 'history';

	const projectId = $derived(Number(page.params.id));

	let project = $state<Project | null>(null);
	let parts = $state<Part[]>([]);
	let plates = $state<PrintPlateDecoded[]>([]);
	let jobs = $state<PrintJobDecoded[]>([]);
	let spools = $state<SpoolWithCatalog[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let tab = $state<Tab>('parts');

	let editOpen = $state(false);
	let parseResult = $state<ParseResult | null>(null);
	let assigning = $state<PrintPlateDecoded | null>(null);
	let printing = $state<PrintPlateDecoded | null>(null);
	let pendingPlateDelete = $state<PrintPlateDecoded | null>(null);
	let pendingJobDelete = $state<PrintJobDecoded | null>(null);
	let confirmProjectDelete = $state(false);

	const durationLabels = $derived({
		day: $t('units.daysShort'),
		hour: $t('units.hoursShort'),
		minute: $t('units.minutesShort')
	});

	// Guards against a slow load for the previous project landing after a faster
	// one for the project the user has already switched to.
	let requestId = 0;

	async function load(id: number) {
		const token = ++requestId;
		if (!Number.isFinite(id)) {
			notFound = true;
			loading = false;
			return;
		}
		try {
			const found = await getProject(id);
			if (token !== requestId) return;
			if (!found) {
				notFound = true;
				return;
			}
			const [nextParts, nextPlates, nextJobs, nextSpools] = await Promise.all([
				listParts(id),
				listPlates(id),
				listJobsForProject(id),
				// Every spool, not just the active ones: logging a print can flip a
				// spool to `empty`, and the job that emptied it still has to be able
				// to show its name in the history.
				listSpools()
			]);
			if (token !== requestId) return;
			project = found;
			parts = nextParts;
			plates = nextPlates;
			jobs = nextJobs;
			spools = nextSpools;
		} catch {
			if (token === requestId) toasts.error('errors.loadFailed');
		} finally {
			if (token === requestId) loading = false;
		}
	}

	/** Re-reads the project currently in the URL. */
	function reload(): Promise<void> {
		return load(projectId);
	}

	// SvelteKit reuses this component when navigating between two projects, so
	// `onMount` would leave the previous project's parts and plates on screen.
	$effect(() => {
		const id = projectId;
		loading = true;
		notFound = false;
		project = null;
		void load(id);
	});

	/** Only active spools can be assigned to a slot for a new print. */
	const activeSpools = $derived(spools.filter((spool) => spool.status === 'active'));

	const tabs: { value: Tab; labelKey: string; count: number }[] = $derived([
		{ value: 'parts', labelKey: 'projects.tabs.parts', count: parts.length },
		{ value: 'plates', labelKey: 'projects.tabs.plates', count: plates.length },
		{ value: 'history', labelKey: 'projects.tabs.history', count: jobs.length }
	]);

	async function confirmPlateDelete() {
		if (pendingPlateDelete?.id === undefined) return;
		try {
			await deletePlate(pendingPlateDelete.id);
			toasts.success('toast.deleted');
			await reload();
		} catch {
			toasts.error('errors.deleteFailed');
		} finally {
			pendingPlateDelete = null;
		}
	}

	async function confirmJobDelete() {
		if (pendingJobDelete?.id === undefined) return;
		try {
			await deleteJob(pendingJobDelete.id);
			toasts.success('toast.deleted');
			await reload();
		} catch {
			toasts.error('errors.deleteFailed');
		} finally {
			pendingJobDelete = null;
		}
	}

	async function confirmProjectRemoval() {
		try {
			await deleteProject(projectId);
			toasts.success('toast.deleted');
			goto('/projects');
		} catch {
			toasts.error('errors.deleteFailed');
		}
	}

	/** Resolve the spool ids stored on a job to readable names. */
	function spoolLabel(spoolId: number): string {
		const spool = spools.find((item) => item.id === spoolId);
		return spool ? `${spool.catalog.brand} · ${spool.catalog.name}` : `#${spoolId}`;
	}
</script>

{#if loading}
	<p class="py-20 text-center text-sm text-zinc-600">{$t('common.loading')}</p>
{:else if notFound || !project}
	<div class="px-8 py-16">
		<div class="card">
			<EmptyState icon={Layers3} title={$t('errors.notFound')} body={$t('errors.notFoundBody')}>
				{#snippet action()}
					<Button variant="secondary" href="/projects">
						<ArrowLeft size={16} />
						{$t('common.back')}
					</Button>
				{/snippet}
			</EmptyState>
		</div>
	</div>
{:else}
	<!-- Bound once so the snippets below keep the narrowed, non-null type. -->
	{@const activeProject = project}
	<PageHeader title={activeProject.title} subtitle={activeProject.description ?? undefined}>
		{#snippet eyebrow()}
			<div class="flex items-center gap-3">
				<a
					href="/projects"
					class="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
				>
					<ArrowLeft size={13} />
					{$t('projects.title')}
				</a>
				<StatusPill
					labelKey="status.{activeProject.status}"
					tone={projectTone(activeProject.status)}
				/>
			</div>
		{/snippet}

		{#snippet actions()}
			{#if activeProject.sourceUrl}
				<Button
					variant="secondary"
					href={activeProject.sourceUrl}
					target="_blank"
					rel="noreferrer noopener"
				>
					<ExternalLink size={15} />
					{$t('projects.openSource')}
				</Button>
			{/if}
			<IconButton label={$t('common.edit')} onclick={() => (editOpen = true)}>
				<Pencil size={16} />
			</IconButton>
			<IconButton
				label={$t('common.delete')}
				tone="danger"
				onclick={() => (confirmProjectDelete = true)}
			>
				<Trash2 size={16} />
			</IconButton>
		{/snippet}
	</PageHeader>

	<div class="px-8 pb-10">
		<div class="mb-6 flex gap-1 border-b border-white/10" role="tablist">
			{#each tabs as item (item.value)}
				{@const selected = tab === item.value}
				<button
					type="button"
					role="tab"
					aria-selected={selected}
					class={cn(
						'relative -mb-px px-4 py-2.5 text-sm font-medium transition-colors',
						selected
							? 'text-indigo-200'
							: 'text-zinc-500 hover:text-zinc-200'
					)}
					onclick={() => (tab = item.value)}
				>
					{$t(item.labelKey)}
					<span class="ml-1.5 text-xs text-zinc-600 tabular-nums">{item.count}</span>
					{#if selected}
						<span
							class="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.8)]"
							aria-hidden="true"
						></span>
					{/if}
				</button>
			{/each}
		</div>

		{#if tab === 'parts'}
			<PartsPanel {projectId} {parts} onChanged={reload} />
		{:else if tab === 'plates'}
			<div class="grid gap-5">
				<PlateDropzone onParsed={(result) => (parseResult = result)} />

				{#if plates.length === 0}
					<div class="card">
						<EmptyState icon={Layers3} title={$t('plates.empty')} body={$t('plates.emptyBody')} />
					</div>
				{:else}
					<ul class="grid gap-4 xl:grid-cols-2">
						{#each plates as plate (plate.id)}
							<PlateCard
								{plate}
								{parts}
								onAssign={(item) => (assigning = item)}
								onPrint={(item) => (printing = item)}
								onDelete={(item) => (pendingPlateDelete = item)}
							/>
						{/each}
					</ul>
				{/if}
			</div>
		{:else}
			<div class="card overflow-hidden">
				{#if jobs.length === 0}
					<EmptyState
						icon={History}
						title={$t('job.historyEmpty')}
						body={$t('job.historyEmptyBody')}
					/>
				{:else}
					<ul class="divide-y divide-white/5">
						{#each jobs as job (job.id)}
							<li class="group flex flex-wrap items-center gap-4 px-5 py-4">
								<StatusPill labelKey="status.{job.status}" tone={jobTone(job.status)} />

								<div class="min-w-0 flex-1">
									<p class="truncate text-sm text-zinc-200">{job.plateName}</p>
									<p class="mt-0.5 text-[11px] text-zinc-600">
										{formatDateTime(job.completedAt ?? job.startedAt)}
										{#if job.actualDurationSeconds}
											· {formatDuration(job.actualDurationSeconds, durationLabels)}
										{/if}
									</p>
									{#if job.failureReason}
										<p class="mt-1 text-[11px] text-rose-400">{job.failureReason}</p>
									{/if}
								</div>

								{#if job.spoolsUsed.length > 0}
									<div class="flex min-w-0 flex-wrap justify-end gap-1.5">
										{#each job.spoolsUsed as usage (usage.slotIndex)}
											<span
												class="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-400"
												title={$t('job.deductedFrom')}
											>
												<span class="max-w-40 truncate">{spoolLabel(usage.spoolId)}</span>
												<span class="text-zinc-500 tabular-nums">
													−{formatGrams(usage.weightGrams)}
												</span>
											</span>
										{/each}
									</div>
								{/if}

								<IconButton
									label={$t('common.delete')}
									tone="danger"
									class="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
									onclick={() => (pendingJobDelete = job)}
								>
									<Trash2 size={15} />
								</IconButton>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>

	<ProjectModal
		open={editOpen}
		{project}
		onClose={() => (editOpen = false)}
		onSaved={reload}
	/>

	<PlateImportModal
		{projectId}
		result={parseResult}
		{parts}
		onClose={() => (parseResult = null)}
		onImported={reload}
	/>

	<AssignPartsModal
		plate={assigning}
		{parts}
		onClose={() => (assigning = null)}
		onSaved={reload}
	/>

	<PrintJobModal
		plate={printing}
		{parts}
		spools={activeSpools}
		onClose={() => (printing = null)}
		onLogged={reload}
	/>

	<ConfirmDialog
		open={pendingPlateDelete !== null}
		title={$t('plates.deleteConfirm', { values: { name: pendingPlateDelete?.name ?? '' } })}
		body={$t('plates.deleteBody')}
		onConfirm={confirmPlateDelete}
		onCancel={() => (pendingPlateDelete = null)}
	/>

	<ConfirmDialog
		open={pendingJobDelete !== null}
		title={$t('job.deleteConfirm')}
		body={$t('job.deleteBody')}
		onConfirm={confirmJobDelete}
		onCancel={() => (pendingJobDelete = null)}
	/>

	<ConfirmDialog
		open={confirmProjectDelete}
		title={$t('projects.deleteConfirm', { values: { title: activeProject.title } })}
		body={$t('projects.deleteBody')}
		onConfirm={confirmProjectRemoval}
		onCancel={() => (confirmProjectDelete = false)}
	/>
{/if}
