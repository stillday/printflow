<script lang="ts">
	import { locale, t } from 'svelte-i18n';
	import { CalendarCheck, CalendarPlus, Clock, Layers3, Play, Puzzle, Trash2 } from '@lucide/svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import ColorSwatch from '$lib/components/ui/ColorSwatch.svelte';
	import { plateTotalWeight, renamePlate } from '$lib/db/plates';
	import { toasts } from '$lib/stores/toast.svelte';
	import { DEFAULT_LOCALE } from '$lib/i18n';
	import type { Part, PrintPlateDecoded } from '$lib/types/schema';
	import { formatDuration, formatGrams, formatNumber } from '$lib/utils/format';
	import { formatPlanDate } from '$lib/utils/plan';
	import { cn } from '$lib/utils/cn';

	interface Props {
		plate: PrintPlateDecoded;
		parts: Part[];
		onAssign: (plate: PrintPlateDecoded) => void;
		onSchedule: (plate: PrintPlateDecoded) => void;
		onPrint: (plate: PrintPlateDecoded) => void;
		onDelete: (plate: PrintPlateDecoded) => void;
		/** Re-read after an edit made here, e.g. the inline rename. */
		onChanged: () => void;
		/** Set while the user is being pointed at this card from a part's chip. */
		highlighted?: boolean;
	}

	let {
		plate,
		parts,
		onAssign,
		onSchedule,
		onPrint,
		onDelete,
		onChanged,
		highlighted = false
	}: Props = $props();

	const durationLabels = $derived({
		day: $t('units.daysShort'),
		hour: $t('units.hoursShort'),
		minute: $t('units.minutesShort')
	});

	const activeLocale = $derived($locale ?? DEFAULT_LOCALE);

	/**
	 * The plan already knows about this plate. Shown because scheduling was a
	 * write with no visible result: the card looked exactly the same afterwards,
	 * so the same plate got planned two or three times.
	 */
	const planned = $derived(plate.plannedCount > 0);
	const plannedLabel = $derived(
		plate.nextPlannedDate
			? // Plan dates are bare `YYYY-MM-DD` local days — `formatDate` would read
				// them as UTC midnight and can show the previous day.
				$t('plates.scheduledOn', {
					values: {
						date: formatPlanDate(plate.nextPlannedDate, activeLocale, {
							weekday: 'short',
							day: 'numeric',
							month: 'numeric'
						})
					}
				})
			: // Planned, but every open entry sits in the past.
				$t('plates.scheduledOverdue')
	);

	/**
	 * The folder the file came from. Two `plate_1.gcode` under different models
	 * are otherwise indistinguishable — and the file name alone is what the card
	 * used to show. Middle-elided so both the model folder (usually the end) and
	 * the root stay readable; the full path is in the `title`.
	 */
	const sourceFolder = $derived.by(() => {
		const path = plate.sourcePath?.trim();
		if (!path) return null;
		const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
		return cut > 0 ? path.slice(0, cut) : path;
	});

	function elideMiddle(value: string, max = 52): string {
		if (value.length <= max) return value;
		const head = Math.ceil((max - 1) / 2);
		return `${value.slice(0, head)}…${value.slice(value.length - (max - 1 - head))}`;
	}

	/** Inline rename, so it no longer hides inside the "assign parts" dialog. */
	async function rename(value: string) {
		const trimmed = value.trim();
		if (plate.id === undefined || !trimmed || trimmed === plate.name) return;
		try {
			await renamePlate(plate.id, trimmed);
			onChanged();
		} catch {
			toasts.error('errors.saveFailed');
		}
	}

	/** Resolve stored part ids to names, skipping parts deleted since import. */
	const assigned = $derived(
		plate.partsOnPlate
			.map((entry) => ({
				part: parts.find((part) => part.id === entry.partId),
				quantity: entry.quantityOnPlate
			}))
			.filter((entry): entry is { part: Part; quantity: number } => entry.part !== undefined)
	);
</script>

<li
	id="plate-{plate.id}"
	class={cn(
		'card group p-5 transition-colors duration-200 hover:border-indigo-500/40',
		highlighted && 'border-indigo-500/60 ring-2 ring-indigo-500/40'
	)}
>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<input
				class="w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-zinc-100 transition-colors hover:border-white/10 focus:border-indigo-500/60 focus:bg-zinc-950 focus:outline-none"
				value={plate.name}
				aria-label={$t('plates.rename')}
				title={$t('plates.rename')}
				onblur={(event) => rename(event.currentTarget.value)}
				onkeydown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
			/>
			<p class="mt-0.5 truncate px-2 text-[11px] text-zinc-400">{plate.fileName}</p>
			{#if sourceFolder}
				<p class="truncate px-2 text-[10px] text-zinc-400" title={plate.sourcePath ?? undefined}>
					{elideMiddle(sourceFolder)}
				</p>
			{/if}
		</div>
		<IconButton label={$t('common.delete')} tone="danger" onclick={() => onDelete(plate)}>
			<Trash2 size={15} />
		</IconButton>
	</div>

	{#if planned}
		<!-- Links to the plan rather than repeating it: the card only has to say
		     "this is already handled, here is when". -->
		<a
			href="/plan"
			class={cn(
				'mt-3 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
				plate.nextPlannedDate
					? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200 hover:border-indigo-500/50'
					: 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:border-amber-500/50'
			)}
			title={$t('plates.scheduledCount', { values: { count: plate.plannedCount } })}
		>
			<CalendarCheck size={12} />
			{plannedLabel}
		</a>
	{/if}

	<div class="mt-4 flex flex-wrap items-center gap-4 text-xs">
		<span class="inline-flex items-center gap-1.5 text-zinc-400">
			<Clock size={13} class="text-zinc-400" />
			{formatDuration(plate.estimatedTimeSeconds, durationLabels)}
		</span>
		{#if plate.layerCount}
			<span class="inline-flex items-center gap-1.5 text-zinc-400">
				<Layers3 size={13} class="text-zinc-400" />
				{formatNumber(plate.layerCount)}
			</span>
		{/if}
		<span class="text-zinc-400 tabular-nums">
			{$t('plates.totalWeight', {
				values: { weight: formatNumber(plateTotalWeight(plate), 1) }
			})}
		</span>
	</div>

	{#if plate.filamentRequirements.length > 0}
		<ul class="mt-3 flex flex-wrap gap-2">
			{#each plate.filamentRequirements as requirement (requirement.slotIndex)}
				<li
					class="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px]"
				>
					<ColorSwatch color={requirement.colorHex} size={12} />
					<span class="text-zinc-400">
						{$t('plates.slotShort', { values: { index: requirement.slotIndex } })}
					</span>
					<span class="text-zinc-300">{requirement.materialType}</span>
					<span class="font-medium text-zinc-100 tabular-nums">
						{formatGrams(requirement.weightGrams)}
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-3 text-[11px] text-zinc-400">{$t('plates.noFilamentData')}</p>
	{/if}

	<div class="mt-4 border-t border-white/5 pt-4">
		<p class="text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
			{$t('plates.partsOnPlate')}
		</p>
		{#if assigned.length > 0}
			<ul class="mt-2 flex flex-wrap gap-1.5">
				{#each assigned as entry (entry.part.id)}
					<li
						class="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-300"
					>
						<span class="truncate">{entry.part.name}</span>
						<span class="text-zinc-400 tabular-nums">{entry.quantity}×</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-2 text-[11px] text-zinc-400">{$t('plates.noPartsAssigned')}</p>
		{/if}
	</div>

	<div class="mt-4 flex items-center gap-2">
		<Button variant="secondary" size="sm" onclick={() => onAssign(plate)}>
			<Puzzle size={14} />
			{$t('plates.assignParts')}
		</Button>
		<Button variant="secondary" size="sm" onclick={() => onSchedule(plate)}>
			<CalendarPlus size={14} />
			{planned ? $t('plan.scheduleAgain') : $t('plan.schedule')}
		</Button>
		<Button variant="primary" size="sm" class="ml-auto" onclick={() => onPrint(plate)}>
			<Play size={14} />
			{$t('plates.startPrint')}
		</Button>
	</div>
</li>
