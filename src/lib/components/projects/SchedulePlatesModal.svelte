<script lang="ts">
	import { t } from 'svelte-i18n';
	import { CalendarPlus, Clock, TriangleAlert } from '@lucide/svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import { createEntry, listPlanRange } from '$lib/db/plan';
	import { listPlates } from '$lib/db/plates';
	import { listProjects } from '$lib/db/projects';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { PrintPlateDecoded, ProjectWithProgress } from '$lib/types/schema';
	import { formatDuration } from '$lib/utils/format';
	import {
		DAY_CAPACITY_SECONDS,
		addPlanDays,
		dayLoadSeconds,
		isOverloaded,
		parsePlanDate,
		todayPlanDate
	} from '$lib/utils/plan';
	import { cn } from '$lib/utils/cn';

	/**
	 * Scheduling one or several plates onto the plan.
	 *
	 * One component for both entry points, because they are the same task: from a
	 * project it opens with that project's plates (the clicked one ticked), from
	 * the plan page it asks which project first. Scheduling several at once is the
	 * normal case — a project's plates are imported in one go and usually printed
	 * over the same few days — and re-picking the date for each of eight plates
	 * was the single biggest complaint about the old flow.
	 */
	interface Props {
		open: boolean;
		/**
		 * Plates to offer. `null` means "ask which project first", which is how the
		 * plan page opens this.
		 */
		plates: PrintPlateDecoded[] | null;
		/** Ids ticked when opening, e.g. the plate whose button was pressed. */
		preselected?: number[];
		/** Day the plan page's per-day button was pressed on. */
		date?: string;
		onClose: () => void;
		onScheduled: () => void;
	}

	let { open, plates, preselected = [], date, onClose, onScheduled }: Props = $props();

	/**
	 * Remembered across openings: planning a batch means picking the same Saturday
	 * again and again, and resetting to today every time fought the user.
	 */
	let lastDate = $state(todayPlanDate());

	let projects = $state<ProjectWithProgress[]>([]);
	let projectId = $state(0);
	let loadedPlates = $state<PrintPlateDecoded[]>([]);
	let selected = $state<number[]>([]);
	let dateInput = $state(todayPlanDate());
	/** Spread over consecutive days instead of piling onto one. */
	let spread = $state(false);
	let dayLoad = $state<number | null>(null);
	let busy = $state(false);

	const durationLabels = $derived({
		day: $t('units.daysShort'),
		hour: $t('units.hoursShort'),
		minute: $t('units.minutesShort')
	});

	/** Either the plates handed in, or those of the chosen project. */
	const available = $derived(plates ?? loadedPlates);
	const chosen = $derived(available.filter((plate) => selected.includes(plate.id!)));
	const chosenSeconds = $derived(
		chosen.reduce((sum, plate) => sum + Math.max(0, plate.estimatedTimeSeconds), 0)
	);
	const valid = $derived(parsePlanDate(dateInput) !== null && chosen.length > 0);
	const isPast = $derived(dateInput < todayPlanDate());

	$effect(() => {
		if (!open) return;
		dateInput = date ?? lastDate;
		spread = false;
		selected = [...preselected];
		if (plates === null) void loadProjects();
	});

	async function loadProjects() {
		try {
			projects = await listProjects();
			if (projects.length > 0 && projectId === 0) {
				projectId = projects[0].id ?? 0;
			}
		} catch {
			toasts.error('errors.loadFailed');
		}
	}

	// Plates of the chosen project, when the modal had to ask.
	$effect(() => {
		if (!open || plates !== null || projectId === 0) return;
		const id = projectId;
		void (async () => {
			try {
				const found = await listPlates(id);
				if (projectId !== id) return;
				loadedPlates = found;
				selected = [];
			} catch {
				toasts.error('errors.loadFailed');
			}
		})();
	});

	// What the target day already holds, so the decision is not made blind.
	$effect(() => {
		if (!open) return;
		const day = dateInput;
		if (!parsePlanDate(day)) {
			dayLoad = null;
			return;
		}
		void (async () => {
			try {
				const entries = await listPlanRange(day, day);
				if (dateInput === day) dayLoad = dayLoadSeconds(entries);
			} catch {
				dayLoad = null;
			}
		})();
	});

	const projectedLoad = $derived((dayLoad ?? 0) + (spread ? 0 : chosenSeconds));

	function toggle(plateId: number) {
		selected = selected.includes(plateId)
			? selected.filter((id) => id !== plateId)
			: [...selected, plateId];
	}

	/**
	 * Fills each day up to a day's worth of printing before moving on, so
	 * "spread" produces something a person could actually work through.
	 */
	function spreadDates(): string[] {
		const dates: string[] = [];
		let day = dateInput;
		let load = dayLoad ?? 0;
		for (const plate of chosen) {
			const seconds = Math.max(0, plate.estimatedTimeSeconds);
			if (load > 0 && load + seconds > DAY_CAPACITY_SECONDS) {
				day = addPlanDays(day, 1);
				load = 0;
			}
			dates.push(day);
			load += seconds;
		}
		return dates;
	}

	async function schedule() {
		if (!valid || busy) return;
		busy = true;
		try {
			const dates = spread ? spreadDates() : chosen.map(() => dateInput);
			for (const [index, plate] of chosen.entries()) {
				await createEntry(plate.id!, dates[index]);
			}
			lastDate = dateInput;
			toasts.success('toast.scheduledCount', { count: chosen.length });
			onScheduled();
			onClose();
		} catch {
			toasts.error('errors.saveFailed');
		} finally {
			busy = false;
		}
	}
</script>

<Modal {open} title={$t('plan.scheduleTitle')} size="lg" {onClose}>
	<div class="grid gap-5">
		{#if plates === null}
			<Field label={$t('files.existingProject')}>
				<select class="input-base" bind:value={projectId}>
					{#each projects as project (project.id)}
						<option value={project.id}>{project.title}</option>
					{/each}
				</select>
			</Field>
		{/if}

		{#if available.length === 0}
			<p class="text-sm text-zinc-400">{$t('plan.noPlates')}</p>
		{:else}
			<div>
				<div class="mb-2 flex items-baseline justify-between gap-3">
					<span class="text-xs font-medium tracking-wide text-zinc-400 uppercase">
						{$t('plan.whichPlates')}
					</span>
					<button
						type="button"
						class="text-[11px] text-indigo-400 transition-colors hover:text-indigo-300"
						onclick={() =>
							(selected =
								selected.length === available.length ? [] : available.map((plate) => plate.id!))}
					>
						{selected.length === available.length ? $t('common.selectNone') : $t('common.selectAll')}
					</button>
				</div>

				<ul class="grid max-h-64 gap-1.5 overflow-y-auto">
					{#each available as plate (plate.id)}
						{@const checked = selected.includes(plate.id!)}
						<li>
							<label
								class={cn(
									'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors',
									checked
										? 'border-indigo-500/40 bg-indigo-500/10'
										: 'border-white/10 bg-zinc-950/40 hover:border-white/20'
								)}
							>
								<input
									type="checkbox"
									class="h-4 w-4 shrink-0 accent-indigo-500"
									{checked}
									onchange={() => toggle(plate.id!)}
								/>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-zinc-100">{plate.name}</span>
									<span class="block truncate text-[11px] text-zinc-400">{plate.fileName}</span>
								</span>
								<span class="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
									<Clock size={12} />
									{formatDuration(plate.estimatedTimeSeconds, durationLabels)}
								</span>
							</label>
						</li>
					{/each}
				</ul>
			</div>

			<Field label={$t('plan.date')}>
				<input class="input-base" type="date" bind:value={dateInput} />
			</Field>

			<div class="flex flex-wrap gap-2">
				{#each [{ key: 'plan.today', value: todayPlanDate() }, { key: 'plan.tomorrow', value: addPlanDays(todayPlanDate(), 1) }, { key: 'plan.inAWeek', value: addPlanDays(todayPlanDate(), 7) }] as choice (choice.key)}
					<Button
						variant={dateInput === choice.value ? 'primary' : 'secondary'}
						size="sm"
						onclick={() => (dateInput = choice.value)}
					>
						{$t(choice.key)}
					</Button>
				{/each}
			</div>

			{#if chosen.length > 1}
				<label class="flex items-start gap-3 text-sm text-zinc-300">
					<input type="checkbox" class="mt-0.5 h-4 w-4 accent-indigo-500" bind:checked={spread} />
					<span>
						{$t('plan.spread')}
						<span class="mt-0.5 block text-[11px] text-zinc-400">{$t('plan.spreadHint')}</span>
					</span>
				</label>
			{/if}

			<!-- What the day looks like afterwards: scheduling blind was the reason
			     days silently ended up with 40 hours of printing on them. -->
			{#if dayLoad !== null && chosen.length > 0}
				<div
					class={cn(
						'rounded-xl border px-4 py-3 text-xs',
						isOverloaded(projectedLoad)
							? 'border-amber-500/30 bg-amber-500/5 text-amber-300'
							: 'border-white/10 bg-zinc-950/40 text-zinc-400'
					)}
				>
					{#if spread}
						{$t('plan.spreadPreview', {
							values: {
								count: chosen.length,
								time: formatDuration(chosenSeconds, durationLabels)
							}
						})}
					{:else}
						<span class="tabular-nums">
							{$t('plan.dayAfter', {
								values: {
									before: formatDuration(dayLoad, durationLabels),
									after: formatDuration(projectedLoad, durationLabels)
								}
							})}
						</span>
						{#if isOverloaded(projectedLoad)}
							<span class="mt-1 flex items-center gap-1.5">
								<TriangleAlert size={12} />
								{$t('plan.overloadedHint')}
							</span>
						{/if}
					{/if}
				</div>
			{/if}

			{#if isPast}
				<p class="text-xs text-amber-300">{$t('plan.pastDate')}</p>
			{/if}
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		<Button variant="primary" onclick={schedule} disabled={!valid || busy}>
			<CalendarPlus size={15} />
			{chosen.length > 1
				? $t('plan.scheduleCount', { values: { count: chosen.length } })
				: $t('plan.schedule')}
		</Button>
	{/snippet}
</Modal>
