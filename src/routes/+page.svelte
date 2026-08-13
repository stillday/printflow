<script lang="ts">
	import { onMount } from 'svelte';
	import { locale, t } from 'svelte-i18n';
	import {
		Boxes,
		CalendarDays,
		Clock,
		FolderKanban,
		Layers,
		Package,
		Plus,
		Sparkles,
		TriangleAlert
	} from '@lucide/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import StatTile from '$lib/components/ui/StatTile.svelte';
	import ProgressBar from '$lib/components/ui/ProgressBar.svelte';
	import ProgressRing from '$lib/components/ui/ProgressRing.svelte';
	import StatusPill from '$lib/components/ui/StatusPill.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { getDashboardStats, type DashboardStats } from '$lib/db/settings';
	import { nextPlanned } from '$lib/db/plan';
	import { listRecentProjects } from '$lib/db/projects';
	import { listSpools } from '$lib/db/spools';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { PlanEntryDecoded, ProjectWithProgress, SpoolWithCatalog } from '$lib/types/schema';
	import { formatDuration, formatGrams, formatHours, formatNumber, formatPercent } from '$lib/utils/format';
	import { formatPlanDate, todayPlanDate } from '$lib/utils/plan';
	import { fillRatio, isLowStock, projectTone, spoolTitle } from '$lib/utils/status';

	let stats = $state<DashboardStats | null>(null);
	let projects = $state<ProjectWithProgress[]>([]);
	let spools = $state<SpoolWithCatalog[]>([]);
	let upcoming = $state<PlanEntryDecoded | null>(null);
	let loading = $state(true);

	const durationLabels = $derived({
		day: $t('units.daysShort'),
		hour: $t('units.hoursShort'),
		minute: $t('units.minutesShort')
	});

	async function load() {
		try {
			[stats, projects, spools, upcoming] = await Promise.all([
				getDashboardStats(),
				listRecentProjects(4),
				listSpools(),
				nextPlanned(todayPlanDate())
			]);
		} catch {
			toasts.error('errors.loadFailed');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const lowSpools = $derived(
		spools
			.filter(isLowStock)
			.sort((a, b) => fillRatio(a) - fillRatio(b))
			.slice(0, 4)
	);

	/** Nothing at all in the database yet — show onboarding instead of zeros. */
	const isFresh = $derived(
		!loading && spools.length === 0 && projects.length === 0 && stats?.activeSpools === 0
	);
</script>

<PageHeader title={$t('dashboard.title')} subtitle={$t('dashboard.subtitle')} />

<div class="px-8 pb-10">
	{#if loading}
		<p class="py-16 text-center text-sm text-zinc-400">{$t('common.loading')}</p>
	{:else if isFresh}
		<div class="card">
			<EmptyState icon={Sparkles} title={$t('dashboard.emptyTitle')} body={$t('dashboard.emptyBody')}>
				{#snippet action()}
					<div class="flex flex-wrap justify-center gap-2">
						<Button variant="primary" href="/catalog">
							<Plus size={16} />
							{$t('catalog.add')}
						</Button>
						<Button variant="secondary" href="/projects">
							<FolderKanban size={16} />
							{$t('projects.add')}
						</Button>
					</div>
				{/snippet}
			</EmptyState>
		</div>
	{:else if stats}
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
			<StatTile
				icon={Boxes}
				label={$t('dashboard.stats.activeSpools')}
				value={formatNumber(stats.activeSpools)}
				tone="indigo"
			/>
			<StatTile
				icon={Layers}
				label={$t('dashboard.stats.filamentStock')}
				value={formatNumber(stats.filamentStockGrams / 1000, 2)}
				unit={$t('units.kilogram')}
				tone="emerald"
			/>
			<StatTile
				icon={FolderKanban}
				label={$t('dashboard.stats.openProjects')}
				value={formatNumber(stats.openProjects)}
				tone="indigo"
			/>
			<StatTile
				icon={Package}
				label={$t('dashboard.stats.partsToPrint')}
				value={formatNumber(stats.partsToPrint)}
				tone={stats.partsToPrint > 0 ? 'amber' : 'emerald'}
			/>
		</div>

		{#if upcoming}
			<a
				href="/plan"
				class="card mt-4 flex flex-wrap items-center gap-4 px-5 py-4 transition-colors duration-200 hover:border-indigo-500/40"
			>
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-300"
				>
					<CalendarDays size={18} />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
						{$t('plan.nextPrint')}
					</p>
					<p class="mt-0.5 truncate text-sm font-medium text-zinc-100">{upcoming.plateName}</p>
					<p class="truncate text-[11px] text-zinc-400">{upcoming.projectTitle}</p>
				</div>
				<div class="text-right">
					<p class="text-sm font-semibold text-indigo-200 tabular-nums">
						{formatPlanDate(upcoming.plannedDate, $locale ?? 'de')}
					</p>
					<p class="text-[11px] text-zinc-400 tabular-nums">
						{formatDuration(upcoming.estimatedTimeSeconds, durationLabels)}
					</p>
				</div>
			</a>
		{/if}

		<div class="mt-6 grid gap-6 xl:grid-cols-3">
			<section class="xl:col-span-2">
				<div class="mb-3 flex items-baseline justify-between gap-3">
					<h2 class="text-sm font-semibold text-zinc-200">{$t('dashboard.recentProjects')}</h2>
					<a href="/projects" class="text-xs text-indigo-400 transition-colors hover:text-indigo-300">
						{$t('projects.title')}
					</a>
				</div>

				{#if projects.length === 0}
					<div class="card">
						<EmptyState
							icon={FolderKanban}
							title={$t('projects.empty')}
							body={$t('projects.emptyBody')}
						>
							{#snippet action()}
								<Button variant="primary" href="/projects">
									<Plus size={16} />
									{$t('projects.add')}
								</Button>
							{/snippet}
						</EmptyState>
					</div>
				{:else}
					<ul class="grid gap-3">
						{#each projects as project (project.id)}
							{@const ratio =
								project.requiredTotal > 0
									? Math.min(1, project.printedTotal / project.requiredTotal)
									: 0}
							<li>
								<a
									href="/projects/{project.id}"
									class="card block p-4 transition-colors duration-200 hover:border-indigo-500/40"
								>
									<div class="flex items-start justify-between gap-3">
										<p class="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
											{project.title}
										</p>
										<StatusPill
											labelKey="status.{project.status}"
											tone={projectTone(project.status)}
										/>
									</div>
									<div class="mt-3">
										<ProgressBar
											value={ratio}
											secondary={project.requiredTotal > 0
												? project.failedTotal / project.requiredTotal
												: 0}
											tone={ratio >= 1 ? 'emerald' : 'indigo'}
										/>
										<p class="mt-2 text-[11px] text-zinc-400">
											{$t('projects.partsProgress', {
												values: {
													printed: project.printedTotal,
													required: project.requiredTotal
												}
											})}
											<span class="ml-2 text-zinc-400">{formatPercent(ratio)}</span>
										</p>
									</div>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section>
				<div class="mb-3 flex items-baseline justify-between gap-3">
					<h2 class="inline-flex items-center gap-2 text-sm font-semibold text-zinc-200">
						{#if lowSpools.length > 0}
							<TriangleAlert size={14} class="text-amber-400" />
						{/if}
						{$t('dashboard.lowStock')}
					</h2>
					<a href="/spools" class="text-xs text-indigo-400 transition-colors hover:text-indigo-300">
						{$t('spools.title')}
					</a>
				</div>

				<div class="card p-4">
					{#if lowSpools.length === 0}
						<p class="py-6 text-center text-xs text-zinc-400">{$t('dashboard.lowStockEmpty')}</p>
					{:else}
						<ul class="grid gap-3">
							{#each lowSpools as spool (spool.id)}
								{@const ratio = fillRatio(spool)}
								<li class="flex items-center gap-3">
									<ProgressRing
										value={ratio}
										color={spool.catalog.colorHex}
										size={44}
										stroke={5}
									/>
									<div class="min-w-0 flex-1">
										<p class="truncate text-xs font-medium text-zinc-200">{spoolTitle(spool)}</p>
										<p class="mt-0.5 text-[11px] text-zinc-400 tabular-nums">
											{formatGrams(spool.currentWeightNet)}
											<span class="text-zinc-400"> · {formatPercent(ratio)}</span>
										</p>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<div class="card mt-4 p-4">
					<div class="flex items-center gap-3">
						<div
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-300"
						>
							<Clock size={17} />
						</div>
						<div class="min-w-0">
							<p class="text-xs font-medium tracking-wide text-zinc-400 uppercase">
								{$t('dashboard.stats.printHours')}
							</p>
							<p class="mt-0.5 text-lg font-semibold text-zinc-50 tabular-nums">
								{formatHours(stats.plannedSeconds)}
								<span class="text-sm font-normal text-zinc-400">{$t('units.hoursShort')}</span>
							</p>
						</div>
					</div>
				</div>
			</section>
		</div>
	{/if}
</div>
