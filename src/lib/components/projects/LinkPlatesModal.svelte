<script lang="ts">
	import { t } from 'svelte-i18n';
	import { Clock, FileBox } from '@lucide/svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ColorSwatch from '$lib/components/ui/ColorSwatch.svelte';
	import PlateDropzone from './PlateDropzone.svelte';
	import { plateTotalWeight, setPlatesForPart } from '$lib/db/plates';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { Part, PrintPlateDecoded } from '$lib/types/schema';
	import type { ParseResult } from '$lib/utils/threemf';
	import { formatDuration, formatGrams, formatNumber } from '$lib/utils/format';
	import { toNumber } from '$lib/utils/validate';
	import { cn } from '$lib/utils/cn';

	/**
	 * The mirror of `AssignPartsModal`: that one answers "which parts sit on this
	 * plate", this one answers "which file prints this part". Both write the same
	 * link, so a user can start from whichever side they happen to be looking at.
	 */
	interface Props {
		part: Part | null;
		plates: PrintPlateDecoded[];
		/** Raised when the project has no files yet and the user drops one here. */
		onParsed: (result: ParseResult) => void;
		onClose: () => void;
		onSaved: () => void;
	}

	let { part, plates, onParsed, onClose, onSaved }: Props = $props();

	/** Quantity per plate, keyed by plate id — '' or '0' means "not on it". */
	let quantities = $state<Record<number, string>>({});
	let busy = $state(false);

	const durationLabels = $derived({
		day: $t('units.daysShort'),
		hour: $t('units.hoursShort'),
		minute: $t('units.minutesShort')
	});

	// Seed from what is stored whenever a different part is opened.
	$effect(() => {
		if (!part?.id) return;
		const seeded: Record<number, string> = {};
		for (const plate of plates) {
			if (plate.id === undefined) continue;
			const entry = plate.partsOnPlate.find((item) => item.partId === part.id);
			seeded[plate.id] = entry ? String(entry.quantityOnPlate) : '';
		}
		quantities = seeded;
	});

	/** How many copies the chosen plates produce in total. */
	const linkedTotal = $derived(
		Object.values(quantities).reduce((sum, raw) => {
			const value = toNumber(raw);
			return sum + (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
		}, 0)
	);

	const required = $derived(part?.requiredQuantity ?? 0);

	async function save() {
		if (!part?.id || busy) return;
		busy = true;
		try {
			const entries = Object.entries(quantities)
				.map(([plateId, raw]) => {
					const value = toNumber(raw);
					return {
						plateId: Number(plateId),
						quantityOnPlate: Number.isFinite(value) && value > 0 ? Math.round(value) : 0
					};
				})
				.filter((entry) => entry.quantityOnPlate > 0);

			await setPlatesForPart(part.projectId, part.id, entries);
			toasts.success('toast.saved');
			onSaved();
			onClose();
		} catch {
			toasts.error('errors.saveFailed');
		} finally {
			busy = false;
		}
	}
</script>

<Modal
	open={part !== null}
	title={$t('parts.linkFilesTitle')}
	subtitle={part?.name}
	size="lg"
	{onClose}
>
	{#if part}
		{#if plates.length === 0}
			<!-- No file in the project yet, so "link a file" has to *be* the import. -->
			<div class="grid gap-4">
				<p class="text-sm text-zinc-400">{$t('parts.linkFilesEmpty')}</p>
				<PlateDropzone
					onParsed={(result) => {
						onClose();
						onParsed(result);
					}}
				/>
			</div>
		{:else}
			<div class="grid gap-4">
				<p class="text-xs text-zinc-400">{$t('parts.linkFilesHint')}</p>

				<ul class="grid gap-2">
					{#each plates as plate (plate.id)}
						{@const value = toNumber(quantities[plate.id!] ?? '')}
						{@const linked = Number.isFinite(value) && value > 0}
						<li
							class={cn(
								'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
								linked
									? 'border-indigo-500/40 bg-indigo-500/10'
									: 'border-white/10 bg-zinc-950/40'
							)}
						>
							<FileBox size={15} class={linked ? 'text-indigo-300' : 'text-zinc-400'} />

							<div class="min-w-0 flex-1">
								<p class="truncate text-sm text-zinc-100">{plate.name}</p>
								<p class="truncate text-[11px] text-zinc-400" title={plate.sourcePath ?? undefined}>
									{plate.fileName}
								</p>
							</div>

							<span class="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
								<Clock size={12} />
								{formatDuration(plate.estimatedTimeSeconds, durationLabels)}
							</span>

							{#if plate.filamentRequirements.length > 0}
								<span class="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
									<ColorSwatch color={plate.filamentRequirements[0].colorHex} size={11} />
									{formatGrams(plateTotalWeight(plate))}
								</span>
							{/if}

							<label class="flex items-center gap-2 text-[11px] text-zinc-400">
								{$t('plates.quantityOnPlate')}
								<input
									class="input-base w-20 text-center"
									inputmode="numeric"
									placeholder="0"
									bind:value={quantities[plate.id!]}
									onkeydown={(event) => event.key === 'Enter' && save()}
								/>
							</label>
						</li>
					{/each}
				</ul>

				<!-- The number the user actually wants: does the plan cover the need? -->
				<p
					class={cn(
						'text-xs tabular-nums',
						linkedTotal === 0
							? 'text-zinc-400'
							: linkedTotal < required
								? 'text-amber-300'
								: linkedTotal > required
									? 'text-rose-400'
									: 'text-emerald-300'
					)}
				>
					{$t('parts.coverage', {
						values: { linked: formatNumber(linkedTotal), required: formatNumber(required) }
					})}
				</p>
			</div>
		{/if}
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		{#if plates.length > 0}
			<Button variant="primary" onclick={save} disabled={busy}>{$t('common.save')}</Button>
		{/if}
	{/snippet}
</Modal>
