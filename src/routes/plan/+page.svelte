<script lang="ts">
	import { locale, t } from 'svelte-i18n';
	import { page } from '$app/state';
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
		GripVertical,
		Play,
		TriangleAlert,
		Trash2
	} from '@lucide/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
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
		parsePlanDate,
		planDays,
		startOfPlanWeek,
		todayPlanDate
	} from '$lib/utils/plan';
	import { cn } from '$lib/utils/cn';

	/**
	 * Re-read on every load: a desktop app stays open for days, and a fixed
	 * "today" would keep marking yesterday's column and mis-sort what counts as
	 * overdue.
	 */
	let today = $state(todayPlanDate());

	/**
	 * `?date=YYYY-MM-DD` opens the week that day falls in. The dashboard links
	 * here that way: an entry three days out often lives in next week, and
	 * landing on the current week would have shown an empty day instead.
	 */
	const linkedDate = page.url.searchParams.get('date');
	// `todayPlanDate()` rather than the reactive `today`: this is the *initial*
	// week only, and the user pages away from it freely afterwards.
	let weekStart = $state(
		startOfPlanWeek(linkedDate && parsePlanDate(linkedDate) ? linkedDate : todayPlanDate())
	);
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

	/**
	 * Drag and drop state. `dragging` is kept alongside the DataTransfer payload
	 * because `getData` is unreadable during `dragover` — the highlight needs to
	 * know which day the entry comes from before it is dropped.
	 */
	let dragging = $state<PlanEntryDecoded | null>(null);
	let dragOverDate = $state<string | null>(null);

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
		today = todayPlanDate();
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

	/**
	 * The one place an entry changes day — the weekday buttons, the date field,
	 * the overdue shortcuts and the drop target all go through here.
	 *
	 * The toast names the target day rather than just saying "moved": a move can
	 * push the entry out of the week on screen (a Sunday shifted forward, an
	 * overdue entry sent to next Tuesday), and without the date the entry simply
	 * appeared to vanish.
	 */
	async function moveTo(entry: PlanEntryDecoded, date: string): Promise<boolean> {
		if (!entry.id || date === entry.plannedDate || !parsePlanDate(date)) return false;
		try {
			await moveToDate(entry.id, date);
			toasts.success('toast.movedTo', { date: dayLabel(date) });
			await load();
			return true;
		} catch {
			toasts.error('errors.saveFailed');
			return false;
		}
	}

	function shift(entry: PlanEntryDecoded, days: number) {
		return moveTo(entry, addPlanDays(entry.plannedDate, days));
	}

	/**
	 * The date field is the keyboard path to any day at all — ±1 day buttons cost
	 * 21 clicks for a move three weeks out, and dragging is not an option for
	 * everyone (WCAG 2.2 SC 2.5.7). On a failed save the field is put back to the
	 * entry's real day, since the row itself did not change.
	 */
	async function pickDate(entry: PlanEntryDecoded, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const ok = await moveTo(entry, input.value);
		if (!ok) input.value = entry.plannedDate;
	}

	function startDrag(entry: PlanEntryDecoded, event: DragEvent) {
		dragging = entry;
		// Some engines refuse to start a drag without any payload.
		event.dataTransfer?.setData('text/plain', String(entry.id));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function dragOver(date: string, event: DragEvent) {
		if (!dragging || dragging.plannedDate === date) return;
		// Only preventDefault marks the day as a valid drop target.
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dragOverDate = date;
	}

	function dragLeave(event: DragEvent) {
		// Moving onto a child fires dragleave on the section — ignore those.
		const next = event.relatedTarget as Node | null;
		if (next && (event.currentTarget as HTMLElement).contains(next)) return;
		dragOverDate = null;
	}

	async function drop(date: string, event: DragEvent) {
		event.preventDefault();
		const entry = dragging;
		dragging = null;
		dragOverDate = null;
		if (entry) await moveTo(entry, date);
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

<!--
	The keyboard- and pointer-accessible way to move an entry to *any* day. Drag
	and drop between the day columns exists as well, but WCAG 2.2 SC 2.5.7
	(Dragging Movements) requires a single-pointer, non-dragging alternative — and
	this field is also the only control that reaches a day outside the shown week.
-->
{#snippet moveDate(entry: PlanEntryDecoded)}
	<input
		type="date"
		class="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-zinc-300 transition-colors tabular-nums hover:border-white/20 focus:border-indigo-500/60 focus-visible:outline-2 focus-visible:outline-indigo-500"
		value={entry.plannedDate}
		draggable="false"
		aria-label={$t('plan.moveToDate')}
		title={$t('plan.moveToDate')}
		onchange={(event) => pickDate(entry, event)}
	/>
{/snippet}

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
							<!-- "Today" alone forced everything onto one already busy day. -->
							<Button variant="secondary" size="sm" onclick={() => moveTo(entry, today)}>
								{$t('plan.moveToToday')}
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onclick={() => moveTo(entry, addPlanDays(today, 1))}
							>
								{$t('plan.moveToTomorrow')}
							</Button>
							{@render moveDate(entry)}
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
			hint now sits above the grid instead of replacing it.
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
		{:else}
			<!-- Dragging and the date field are both invisible affordances, so the
			     two ways to move an entry are spelled out once above the week. -->
			<p class="mb-3 text-[11px] text-zinc-400">{$t('plan.moveHint')}</p>
		{/if}

		{#key weekStart}
			<div class="grid gap-4 2xl:grid-cols-2">
				{#each days as date (date)}
					{@const dayEntries = byDate.get(date) ?? []}
					{@const load = dayLoadSeconds(dayEntries)}
					{@const isToday = date === today}
					{@const isDropTarget = dragOverDate === date}
					<!--
						The day is the drop target for an entry dragged out of another day;
						`moveDate` above does the same thing without a drag.
					-->
					<section
						class={cn(
							'card p-5 transition-colors',
							isToday && 'border-indigo-500/40 shadow-indigo-950/30',
							isDropTarget && 'border-indigo-400/70 bg-indigo-500/5'
						)}
						role="group"
						aria-label={weekdayName(date)}
						ondragover={(event) => dragOver(date, event)}
						ondragleave={dragLeave}
						ondrop={(event) => drop(date, event)}
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

							<!-- Day load and "add here" belong together on the right; the add
							     button used to float in the middle of the header. -->
							<div class="flex shrink-0 items-center gap-1.5">
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

								<IconButton label={$t('plan.addToDay')} onclick={() => openScheduler(date)}>
									<CalendarPlus size={15} />
								</IconButton>
							</div>
						</div>

						{#if dayEntries.length === 0}
							<button
								type="button"
								class={cn(
									'mt-4 w-full rounded-xl border border-dashed px-4 py-3 text-[11px] transition-colors',
									isDropTarget
										? 'border-indigo-400/60 text-indigo-200'
										: 'border-white/10 text-zinc-400 hover:border-indigo-500/40 hover:text-zinc-200'
								)}
								onclick={() => openScheduler(date)}
							>
								{#if isDropTarget}
									{$t('plan.dropHere')}
								{:else}
									+ {$t('plan.addToDay')}
								{/if}
							</button>
						{:else}
							<ul class="mt-4 grid gap-2">
								{#each dayEntries as entry, index (entry.id)}
									<li
										class={cn(
											'rounded-xl border border-white/10 bg-zinc-950/40 px-4 py-3',
											entry.status !== 'planned' && 'opacity-55',
											dragging?.id === entry.id && 'opacity-40'
										)}
										draggable={entry.status === 'planned'}
										ondragstart={(event) => startDrag(entry, event)}
										ondragend={() => {
											dragging = null;
											dragOverDate = null;
										}}
									>
										<div class="flex flex-wrap items-center gap-3">
											{#if entry.status === 'planned'}
												<span
													class="-ml-1 cursor-grab text-zinc-400"
													aria-hidden="true"
													title={$t('plan.dragHandle')}
												>
													<GripVertical size={14} />
												</span>
											{/if}
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
														<!-- Any other day, in one step instead of up to 21 clicks. -->
														{@render moveDate(entry)}
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

							{#if isDropTarget}
								<!-- Dropped entries land at the end of the day's queue. -->
								<p
									class="mt-2 rounded-xl border border-dashed border-indigo-400/60 px-4 py-2 text-center text-[11px] text-indigo-200"
								>
									{$t('plan.dropHere')}
								</p>
							{/if}
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
