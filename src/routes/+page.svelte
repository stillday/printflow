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
	import { listOverdue, listPlanRange } from '$lib/db/plan';
	import { listRecentProjects } from '$lib/db/projects';
	import { listSpools } from '$lib/db/spools';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { PlanEntryDecoded, ProjectWithProgress, SpoolWithCatalog } from '$lib/types/schema';
	import { formatDuration, formatGrams, formatHours, formatNumber, formatPercent } from '$lib/utils/format';
	import { addPlanDays, formatPlanDate, todayPlanDate } from '$lib/utils/plan';
	import { fillRatio, isLowStock, projectTone, spoolTitle } from '$lib/utils/status';

	/** How many days ahead the dashboard looks, and how many rows it shows. */
	const UPCOMING_DAYS = 6;
	const UPCOMING_ROWS = 3;

	/**
	 * Re-read on every load rather than captured once at mount: this is a desktop
	 * app that stays open for days, and a fixed "today" would keep labelling
	 * yesterday's entries "Today" and query a window that has drifted.
	 */
	let today = $state(todayPlanDate());
	const tomorrow = $derived(addPlanDays(today, 1));

	let stats = $state<DashboardStats | null>(null);
	let projects = $state<ProjectWithProgress[]>([]);
	let spools = $state<SpoolWithCatalog[]>([]);
	/** Everything still open in the next few days — not just the very next print. */
	let planned = $state<PlanEntryDecoded[]>([]);
	/**
	 * Open entries whose day has passed. Without them the dashboard could report
	 * "nothing planned" while five prints were sitting in last week, unprinted.
	 */
	let overdue = $state(0);
	let loading = $state(true);

	const durationLabels = $derived({
		day: $t('units.daysShort'),
		hour: $t('units.hoursShort'),
		minute: $t('units.minutesShort')
	});

	async function load() {
		today = todayPlanDate();
		try {
			const [statsData, projectData, spoolData, planData, overdueData] = await Promise.all([
				getDashboardStats(),
				listRecentProjects(4),
				listSpools(),
				listPlanRange(today, addPlanDays(today, UPCOMING_DAYS)),
				listOverdue(today)
			]);
			stats = statsData;
			projects = projectData;
			spools = spoolData;
			// Already printed or skipped entries are not something to resume.
			planned = planData.filter((entry) => entry.status === 'planned');
			overdue = overdueData.length;
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

	const upcoming = $derived(planned.slice(0, UPCOMING_ROWS));
	const upcomingRest = $derived(planned.length - upcoming.length);

	/**
	 * "Heute"/"Morgen" instead of a date for the two days that matter most — those
	 * are the rows someone acts on straight away.
	 */
	function planDayLabel(date: string): string {
		if (date === today) return $t('plan.today');
		if (date === tomorrow) return $t('plan.tomorrow');
		return formatPlanDate(date, $locale ?? 'de', {
			weekday: 'short',
			day: '2-digit',
			month: '2-digit'
		});
	}

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
		<!-- Every number is a question ("which 37 parts?"), so every tile leads to
		     the list it was counted from. -->
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
			<StatTile
				icon={Boxes}
				label={$t('dashboard.stats.activeSpools')}
				value={formatNumber(stats.activeSpools)}
				tone="indigo"
				href="/spools"
			/>
			<StatTile
				icon={Layers}
				label={$t('dashboard.stats.filamentStock')}
				value={formatNumber(stats.filamentStockGrams / 1000, 2)}
				unit={$t('units.kilogram')}
				tone="emerald"
				href="/spools"
			/>
			<StatTile
				icon={FolderKanban}
				label={$t('dashboard.stats.openProjects')}
				value={formatNumber(stats.openProjects)}
				tone="indigo"
				href="/projects"
			/>
			<StatTile
				icon={Package}
				label={$t('dashboard.stats.partsToPrint')}
				value={formatNumber(stats.partsToPrint)}
				tone={stats.partsToPrint > 0 ? 'amber' : 'emerald'}
				href="/projects"
			/>
		</div>

		<!--
			The next few days rather than a single row: one print told you nothing
			about whether tonight is free, and hid everything queued behind it.
			Each row opens the plan on its own week, so the day is actually visible.
		-->
		<section class="card mt-4 p-4">
			<div class="mb-3 flex items-baseline justify-between gap-3">
				<h2 class="inline-flex items-center gap-2 text-sm font-semibold text-zinc-200">
					<CalendarDays size={14} class="text-indigo-300" />
					{$t('dashboard.upcoming')}
				</h2>
				<a href="/plan" class="text-xs text-indigo-400 transition-colors hover:text-indigo-300">
					{$t('plan.title')}
				</a>
			</div>

			{#if overdue > 0}
				<a
					href="/plan"
					class="mb-2 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-[11px] text-amber-200 transition-colors hover:border-amber-400/60"
				>
					<TriangleAlert size={13} class="shrink-0" />
					{$t('plan.overdue', { values: { count: overdue } })}
				</a>
			{/if}

			{#if upcoming.length === 0}
				<p class="py-4 text-center text-xs text-zinc-400">{$t('dashboard.upcomingEmpty')}</p>
			{:else}
				<ul class="grid gap-2">
					{#each upcoming as entry (entry.id)}
						<li>
							<a
								href="/plan?date={entry.plannedDate}"
								class="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-zinc-950/40 px-4 py-3 transition-colors hover:border-indigo-500/40"
							>
								<span class="w-20 shrink-0 text-xs font-medium text-indigo-200 tabular-nums">
									{planDayLabel(entry.plannedDate)}
								</span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm text-zinc-100">{entry.plateName}</span>
									<span class="block truncate text-[11px] text-zinc-400">{entry.projectTitle}</span>
								</span>
								<span class="shrink-0 text-[11px] text-zinc-400 tabular-nums">
									{formatDuration(entry.estimatedTimeSeconds, durationLabels)}
								</span>
							</a>
						</li>
					{/each}
				</ul>

				{#if upcomingRest > 0}
					<a
						href="/plan"
						class="mt-2 block text-center text-[11px] text-indigo-400 transition-colors hover:text-indigo-300"
					>
						{$t('dashboard.upcomingMore', { values: { count: upcomingRest } })}
					</a>
				{/if}
			{/if}
		</section>

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
