<script lang="ts">
	import { locale, t } from 'svelte-i18n';
	import {
		ArrowDown,
		ArrowUp,
		CalendarArrowDown,
		CalendarArrowUp,
		CalendarDays,
		CalendarPlus,
		ChevronLeft,
		ChevronRight,
		Clock,
		Play,
		TriangleAlert,
		Trash2
	} from '@lucide/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import PrintJobModal from '$lib/components/projects/PrintJobModal.svelte';
	import SchedulePlatesModal from '$lib/components/projects/SchedulePlatesModal.svelte';
	import {
		deleteEntry,
		listOverdue,
		listPlanRange,
		moveToDate,
		setPositions,
		setStatus
	} from '$lib/db/plan';
	import { getPlate } from '$lib/db/plates';
	import { listParts } from '$lib/db/parts';
	import { listSpools } from '$lib/db/spools';
	import { toasts } from '$lib/stores/toast.svelte';
	import type {
		Part,
		PlanEntryDecoded,
		PrintPlateDecoded,
		SpoolWithCatalog
	} from '$lib/types/schema';
	import { formatDuration, formatGrams } from '$lib/utils/format';
	import {
		addPlanDays,
		dayLoadSeconds,
		formatPlanDate,
		groupByDate,
		isOverloaded,
		materialTotals,
		planDays,
		startOfPlanWeek,
		todayPlanDate
	} from '$lib/utils/plan';
	import { cn } from '$lib/utils/cn';

	const today = todayPlanDate();

	let weekStart = $state(startOfPlanWeek(today));
	let entries = $state<PlanEntryDecoded[]>([]);
	let overdue = $state<PlanEntryDecoded[]>([]);
	let spools = $state<SpoolWithCatalog[]>([]);
	let loading = $state(true);

	/** Plate plus its project's parts, as PrintJobModal needs both. */
	let printing = $state<{ plate: PrintPlateDecoded; parts: Part[]; entryId: number } | null>(null);
	let pendingDelete = $state<PlanEntryDecoded | null>(null);
	/** Open state of the scheduler, plus the day a per-day button was pressed on. */
	let addOpen = $state(false);
	let addDate = $state<string | undefined>(undefined);

	function openScheduler(date?: string) {
		addDate = date;
		addOpen = true;
	}

	const days = $derived(planDays(weekStart));
	const weekEnd = $derived(addPlanDays(weekStart, 6));
	const byDate = $derived(groupByDate(entries));
	const weekLoad = $derived(dayLoadSeconds(entries));
	const weekMaterials = $derived(materialTotals(entries));

	const durationLabels = $derived({
		day: $t('units.daysShort'),
		hour: $t('units.hoursShort'),
		minute: $t('units.minutesShort')
	});

	const activeLocale = $derived($locale ?? 'de');

	async function load() {
		try {
			[entries, overdue, spools] = await Promise.all([
				listPlanRange(weekStart, addPlanDays(weekStart, 6)),
				listOverdue(today),
				listSpools()
			]);
		} catch {
			toasts.error('errors.loadFailed');
		} finally {
			loading = false;
		}
	}

	// Also does the initial load; `weekStart` is read synchronously inside
	// `load`, so paging to another week re-runs this.
	$effect(() => {
		void weekStart;
		void load();
	});

	const activeSpools = $derived(spools.filter((spool) => spool.status === 'active'));

	function weekdayName(date: string): string {
		return formatPlanDate(date, activeLocale, { weekday: 'long' });
	}

	function dayLabel(date: string): string {
		return formatPlanDate(date, activeLocale);
	}

	/** "Mo", "Di" — short enough to sit on a button next to the arrow. */
	function weekdayShort(date: string): string {
		return formatPlanDate(date, activeLocale, { weekday: 'short' });
	}

	async function shift(entry: PlanEntryDecoded, days: number) {
		if (!entry.id) return;
		try {
			await moveToDate(entry.id, addPlanDays(entry.plannedDate, days));
			await load();
		} catch {
			toasts.error('errors.saveFailed');
		}
	}

	async function moveTo(entry: PlanEntryDecoded, date: string) {
		if (!entry.id) return;
		try {
			await moveToDate(entry.id, date);
			toasts.success('toast.moved');
			await load();
		} catch {
			toasts.error('errors.saveFailed');
		}
	}

	/** Swaps an entry with its neighbour inside the same day. */
	async function reorder(entry: PlanEntryDecoded, direction: -1 | 1) {
		const day = byDate.get(entry.plannedDate) ?? [];
		const index = day.findIndex((item) => item.id === entry.id);
		const target = index + direction;
		if (index < 0 || target < 0 || target >= day.length) return;

		const reordered = [...day];
		[reordered[index], reordered[target]] = [reordered[target], reordered[index]];
		try {
			await setPositions(
				reordered.map((item, position) => ({ id: item.id!, position }))
			);
			await load();
		} catch {
			toasts.error('errors.saveFailed');
		}
	}

	/** Puts a closed entry back on the plan — e.g. after deleting its job. */
	async function reopen(entry: PlanEntryDecoded) {
		if (!entry.id) return;
		try {
			await setStatus(entry.id, 'planned');
			await load();
		} catch {
			toasts.error('errors.saveFailed');
		}
	}

	/** Logging a print needs the full plate and its project's parts. */
	async function startLogging(entry: PlanEntryDecoded) {
		if (!entry.id) return;
		try {
			const [plate, parts] = await Promise.all([
				getPlate(entry.plateId),
				listParts(entry.projectId)
			]);
			if (!plate) {
				toasts.error('errors.notFound');
				return;
			}
			printing = { plate, parts, entryId: entry.id };
		} catch {
			toasts.error('errors.loadFailed');
		}
	}

	async function confirmDelete() {
		if (!pendingDelete?.id) return;
		try {
			await deleteEntry(pendingDelete.id);
			toasts.success('toast.deleted');
			await load();
		} catch {
			toasts.error('errors.deleteFailed');
		} finally {
			pendingDelete = null;
		}
	}
</script>

<PageHeader title={$t('plan.title')} subtitle={$t('plan.subtitle')}>
	{#snippet actions()}
		<div class="flex items-center gap-1.5">
			<IconButton
				label={$t('plan.previousWeek')}
				onclick={() => (weekStart = addPlanDays(weekStart, -7))}
			>
				<ChevronLeft size={16} />
			</IconButton>
			<Button
				variant={weekStart === startOfPlanWeek(today) ? 'primary' : 'secondary'}
				size="sm"
				onclick={() => (weekStart = startOfPlanWeek(today))}
			>
				{$t('plan.thisWeek')}
			</Button>
			<IconButton
				label={$t('plan.nextWeek')}
				onclick={() => (weekStart = addPlanDays(weekStart, 7))}
			>
				<ChevronRight size={16} />
			</IconButton>

			<!-- The page is called "print plan" and could not plan anything. -->
			<Button variant="primary" onclick={() => openScheduler()}>
				<CalendarPlus size={15} />
				{$t('plan.add')}
			</Button>
		</div>
	{/snippet}
</PageHeader>

<div class="px-8 pb-10">
	{#if loading}
		<p class="py-16 text-center text-sm text-zinc-400">{$t('common.loading')}</p>
	{:else}
		<!-- Week summary: total time and the filament it will consume. -->
		<div class="card mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
			<div>
				<p class="text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
					{$t('plan.weekOf', {
						values: { from: dayLabel(weekStart), to: dayLabel(weekEnd) }
					})}
				</p>
				<p class="mt-1 text-sm font-semibold text-zinc-100 tabular-nums">
					{formatDuration(weekLoad, durationLabels)}
					<span class="ml-1 text-xs font-normal text-zinc-400">
						{$t('plan.plannedTime')}
					</span>
				</p>
			</div>

			{#if weekMaterials.length > 0}
				<ul class="ml-auto flex flex-wrap gap-2">
					{#each weekMaterials as total (total.material)}
						<li
							class="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px]"
						>
							<span class="text-zinc-300">{total.material}</span>
							<span class="font-medium text-zinc-100 tabular-nums">
								{formatGrams(total.grams)}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if overdue.length > 0}
			<section
				class="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 shadow-lg shadow-black/20"
			>
				<div class="flex items-center gap-2">
					<TriangleAlert size={15} class="text-amber-400" />
					<h2 class="text-sm font-semibold text-amber-200">
						{$t('plan.overdue', { values: { count: overdue.length } })}
					</h2>
				</div>
				<p class="mt-1 text-xs text-zinc-400">{$t('plan.overdueHint')}</p>

				<ul class="mt-4 grid gap-2">
					{#each overdue as entry (entry.id)}
						<li
							class="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-zinc-950/40 px-4 py-3"
						>
							<span class="text-[11px] text-amber-300 tabular-nums">
								{dayLabel(entry.plannedDate)}
							</span>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm text-zinc-100">{entry.plateName}</p>
								<p class="truncate text-[11px] text-zinc-400">{entry.projectTitle}</p>
							</div>
							<Button variant="secondary" size="sm" onclick={() => moveTo(entry, today)}>
								{$t('plan.moveToToday')}
							</Button>
							<IconButton
								label={$t('common.delete')}
								tone="danger"
								onclick={() => (pendingDelete = entry)}
							>
								<Trash2 size={15} />
							</IconButton>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!--
			The empty week used to replace the day grid entirely — hiding the seven
			days at exactly the moment the user wants somewhere to plan into. The
			hint now sits above the grid instead of instead of it.
		-->
		{#if entries.length === 0}
			<div class="card mb-4 flex flex-wrap items-center gap-4 px-5 py-4">
				<CalendarDays size={18} class="shrink-0 text-zinc-400" />
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium text-zinc-100">{$t('plan.empty')}</p>
					<p class="mt-0.5 text-xs text-zinc-400">{$t('plan.emptyBody')}</p>
				</div>
				<Button variant="primary" onclick={() => openScheduler()}>
					<CalendarPlus size={15} />
					{$t('plan.add')}
				</Button>
			</div>
		{/if}

		{#key weekStart}
			<div class="grid gap-4 2xl:grid-cols-2">
				{#each days as date (date)}
					{@const dayEntries = byDate.get(date) ?? []}
					{@const load = dayLoadSeconds(dayEntries)}
					{@const isToday = date === today}
					<section
						class={cn(
							'card p-5',
							isToday && 'border-indigo-500/40 shadow-indigo-950/30'
						)}
					>
						<div class="flex items-baseline justify-between gap-3">
							<div class="min-w-0">
								<h2
									class={cn(
										'text-sm font-semibold',
										isToday ? 'text-indigo-200' : 'text-zinc-100'
									)}
								>
									{weekdayName(date)}
									{#if isToday}
										<span class="ml-1.5 text-[10px] tracking-widest uppercase">
											{$t('plan.today')}
										</span>
									{/if}
								</h2>
								<p class="mt-0.5 text-[11px] text-zinc-400 tabular-nums">{dayLabel(date)}</p>
							</div>

							<IconButton label={$t('plan.addToDay')} onclick={() => openScheduler(date)}>
								<CalendarPlus size={15} />
							</IconButton>

							{#if dayEntries.length > 0}
								<span
									class={cn(
										'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] tabular-nums',
										isOverloaded(load)
											? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
											: 'border-white/10 bg-white/5 text-zinc-300'
									)}
									title={isOverloaded(load) ? $t('plan.overloadedHint') : undefined}
								>
									<Clock size={12} />
									{formatDuration(load, durationLabels)}
								</span>
							{/if}
						</div>

						{#if dayEntries.length === 0}
							<button
								type="button"
								class="mt-4 w-full rounded-xl border border-dashed border-white/10 px-4 py-3 text-[11px] text-zinc-400 transition-colors hover:border-indigo-500/40 hover:text-zinc-200"
								onclick={() => openScheduler(date)}
							>
								+ {$t('plan.addToDay')}
							</button>
						{:else}
							<ul class="mt-4 grid gap-2">
								{#each dayEntries as entry, index (entry.id)}
									<li
										class={cn(
											'rounded-xl border border-white/10 bg-zinc-950/40 px-4 py-3',
											entry.status !== 'planned' && 'opacity-55'
										)}
									>
										<div class="flex flex-wrap items-center gap-3">
											<span class="text-[11px] text-zinc-400 tabular-nums">{index + 1}</span>

											<div class="min-w-0 flex-1">
												<p
													class={cn(
														'truncate text-sm text-zinc-100',
														entry.status === 'done' && 'line-through'
													)}
												>
													{entry.plateName}
												</p>
												<p class="truncate text-[11px] text-zinc-400">
													<a
														href="/projects/{entry.projectId}"
														class="transition-colors hover:text-zinc-200"
													>
														{entry.projectTitle}
													</a>
													· {formatDuration(entry.estimatedTimeSeconds, durationLabels)}
												</p>
												{#if entry.note}
													<p class="mt-1 truncate text-[11px] text-zinc-400 italic">
														{entry.note}
													</p>
												{/if}
											</div>

											{#if entry.status === 'planned'}
												<div class="flex items-center gap-2">
													<!--
														Two different actions that used to look alike: reordering
														inside the day, and moving to another day. Vertical arrows
														for the queue, the target weekday spelled out for the move.
													-->
													<div
														class="flex items-center rounded-lg border border-white/10 bg-white/5"
														role="group"
														aria-label={$t('plan.orderGroup')}
													>
														<IconButton
															label={$t('plan.moveUp')}
															disabled={index === 0}
															onclick={() => reorder(entry, -1)}
														>
															<ArrowUp size={14} />
														</IconButton>
														<span class="text-[10px] text-zinc-400 tabular-nums">
															{index + 1}/{dayEntries.length}
														</span>
														<IconButton
															label={$t('plan.moveDown')}
															disabled={index === dayEntries.length - 1}
															onclick={() => reorder(entry, 1)}
														>
															<ArrowDown size={14} />
														</IconButton>
													</div>

													<div class="flex items-center gap-1">
														<Button
															variant="ghost"
															size="sm"
															title={$t('plan.moveToDay', {
																values: { day: weekdayName(addPlanDays(entry.plannedDate, -1)) }
															})}
															onclick={() => shift(entry, -1)}
														>
															<CalendarArrowUp size={13} />
															{weekdayShort(addPlanDays(entry.plannedDate, -1))}
														</Button>
														<Button
															variant="ghost"
															size="sm"
															title={$t('plan.moveToDay', {
																values: { day: weekdayName(addPlanDays(entry.plannedDate, 1)) }
															})}
															onclick={() => shift(entry, 1)}
														>
															{weekdayShort(addPlanDays(entry.plannedDate, 1))}
															<CalendarArrowDown size={13} />
														</Button>
													</div>

													<Button
														variant="primary"
														size="sm"
														onclick={() => startLogging(entry)}
													>
														<Play size={13} />
														{$t('plan.logPrint')}
													</Button>
												</div>
											{:else}
												<span class="text-[11px] tracking-wide text-zinc-400 uppercase">
													{$t(`plan.status.${entry.status}`)}
												</span>
												<Button variant="ghost" size="sm" onclick={() => reopen(entry)}>
													{$t('plan.reopen')}
												</Button>
											{/if}

											<IconButton
												label={$t('common.delete')}
												tone="danger"
												onclick={() => (pendingDelete = entry)}
											>
												<Trash2 size={15} />
											</IconButton>
										</div>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/each}
			</div>
		{/key}
	{/if}
</div>

<SchedulePlatesModal
	open={addOpen}
	plates={null}
	date={addDate}
	onClose={() => (addOpen = false)}
	onScheduled={load}
/>

<PrintJobModal
	plate={printing?.plate ?? null}
	parts={printing?.parts ?? []}
	spools={activeSpools}
	planEntryId={printing?.entryId ?? null}
	onClose={() => (printing = null)}
	onLogged={load}
/>

<ConfirmDialog
	open={pendingDelete !== null}
	title={$t('plan.deleteConfirm')}
	body={$t('plan.deleteBody')}
	onConfirm={confirmDelete}
	onCancel={() => (pendingDelete = null)}
/>
