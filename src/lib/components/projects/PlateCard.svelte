<script lang="ts">
	import { t } from 'svelte-i18n';
	import { Clock, Layers3, Play, Puzzle, Trash2 } from '@lucide/svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import ColorSwatch from '$lib/components/ui/ColorSwatch.svelte';
	import { plateTotalWeight } from '$lib/db/plates';
	import type { Part, PrintPlateDecoded } from '$lib/types/schema';
	import { formatDuration, formatGrams, formatNumber } from '$lib/utils/format';

	interface Props {
		plate: PrintPlateDecoded;
		parts: Part[];
		onAssign: (plate: PrintPlateDecoded) => void;
		onPrint: (plate: PrintPlateDecoded) => void;
		onDelete: (plate: PrintPlateDecoded) => void;
	}

	let { plate, parts, onAssign, onPrint, onDelete }: Props = $props();

	const durationLabels = $derived({
		day: $t('units.daysShort'),
		hour: $t('units.hoursShort'),
		minute: $t('units.minutesShort')
	});

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

<li class="card group p-5 transition-colors duration-200 hover:border-indigo-500/40">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="truncate text-sm font-semibold text-zinc-100">{plate.name}</p>
			<p class="mt-0.5 truncate text-[11px] text-zinc-400">{plate.fileName}</p>
		</div>
		<IconButton label={$t('common.delete')} tone="danger" onclick={() => onDelete(plate)}>
			<Trash2 size={15} />
		</IconButton>
	</div>

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
		<Button variant="primary" size="sm" class="ml-auto" onclick={() => onPrint(plate)}>
			<Play size={14} />
			{$t('plates.startPrint')}
		</Button>
	</div>
</li>
