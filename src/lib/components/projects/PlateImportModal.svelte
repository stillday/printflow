<script lang="ts">
	import { t } from 'svelte-i18n';
	import { Clock, Layers3, TriangleAlert } from '@lucide/svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ColorSwatch from '$lib/components/ui/ColorSwatch.svelte';
	import { addRequiredQuantity, createPart } from '$lib/db/parts';
	import { createPlate } from '$lib/db/plates';
	import { touchProject } from '$lib/db/projects';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { Part, PartOnPlate } from '$lib/types/schema';
	import { formatDuration, formatGrams, formatNumber } from '$lib/utils/format';
	import { suggestPlateName, type ParsedObject, type ParseResult } from '$lib/utils/threemf';

	interface Props {
		projectId: number;
		result: ParseResult | null;
		parts: Part[];
		/**
		 * Absolute path the file came from, when it was picked from disk rather
		 * than dropped onto the window. Stored so the library scanner can tell
		 * which files are already in a project.
		 */
		sourcePath?: string | null;
		onClose: () => void;
		onImported: () => void;
	}

	let { projectId, result, parts, sourcePath = null, onClose, onImported }: Props = $props();

	/** `create` makes a new part, a number links to an existing one, 0 ignores. */
	type Mapping = number | 'create';

	let plateNames = $state<string[]>([]);
	let mappings = $state<Mapping[][]>([]);
	let busy = $state(false);

	const durationLabels = $derived({
		day: $t('units.daysShort'),
		hour: $t('units.hoursShort'),
		minute: $t('units.minutesShort')
	});

	// Seed the form each time a new parse result arrives. Objects are matched to
	// existing parts by name so re-importing a revised plate keeps its links.
	$effect(() => {
		if (!result) return;
		plateNames = result.plates.map((plate) =>
			suggestPlateName(result.fileName, plate, result.plates.length)
		);
		mappings = result.plates.map((plate) =>
			plate.objects.map((object) => {
				const match = parts.find(
					(part) => part.name.trim().toLowerCase() === object.name.trim().toLowerCase()
				);
				return match?.id ?? 'create';
			})
		);
	});

	function totalWeight(index: number): number {
		return (
			result?.plates[index].filamentRequirements.reduce((sum, req) => sum + req.weightGrams, 0) ?? 0
		);
	}

	async function resolvePart(
		object: ParsedObject,
		mapping: Mapping,
		created: Map<string, number>
	): Promise<number | null> {
		if (mapping === 'create') {
			const key = object.name.trim().toLowerCase();
			// A name may appear on several plates — create it once, but keep
			// raising how many are needed, or a part spread over three plates
			// would be recorded as if only the first plate's copies counted.
			const existing = created.get(key);
			if (existing) {
				await addRequiredQuantity(existing, object.quantity);
				return existing;
			}

			const id = await createPart({
				projectId,
				name: object.name,
				requiredQuantity: object.quantity,
				printedQuantity: 0,
				failedQuantity: 0
			});
			created.set(key, id);
			return id;
		}
		return mapping > 0 ? mapping : null;
	}

	async function importPlates() {
		if (!result || busy) return;
		busy = true;

		try {
			const created = new Map<string, number>();

			for (const [index, plate] of result.plates.entries()) {
				const partsOnPlate: PartOnPlate[] = [];
				for (const [objectIndex, object] of plate.objects.entries()) {
					const partId = await resolvePart(object, mappings[index][objectIndex], created);
					if (partId) partsOnPlate.push({ partId, quantityOnPlate: object.quantity });
				}

				await createPlate({
					projectId,
					name: plateNames[index]?.trim() || result.fileName,
					fileName: result.fileName,
					estimatedTimeSeconds: plate.estimatedTimeSeconds,
					layerCount: plate.layerCount,
					filamentRequirementsJson: JSON.stringify(plate.filamentRequirements),
					partsOnPlateJson: JSON.stringify(partsOnPlate),
					sourcePath
				});
			}

			await touchProject(projectId);
			toasts.success('toast.plateAdded');
			onImported();
			onClose();
		} catch {
			toasts.error('errors.saveFailed');
		} finally {
			busy = false;
		}
	}
</script>

<Modal
	open={result !== null}
	title={$t('plates.title')}
	subtitle={result?.fileName}
	size="lg"
	{onClose}
>
	{#if result}
		<div class="grid gap-5">
			{#each result.warnings as warning (warning)}
				<div
					class="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3"
				>
					<TriangleAlert size={16} class="mt-0.5 shrink-0 text-amber-400" />
					<p class="text-xs leading-relaxed text-amber-200">{$t(warning)}</p>
				</div>
			{/each}

			{#each result.plates as plate, index (plate.index)}
				<div class="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
					<label class="block">
						<span class="label-base">{$t('plates.rename')}</span>
						<input class="input-base" bind:value={plateNames[index]} />
					</label>

					<div class="mt-4 flex flex-wrap items-center gap-4 text-xs">
						<span class="inline-flex items-center gap-1.5 text-zinc-400">
							<Clock size={13} class="text-zinc-400" />
							{formatDuration(plate.estimatedTimeSeconds, durationLabels)}
						</span>
						{#if plate.layerCount}
							<span class="inline-flex items-center gap-1.5 text-zinc-400">
								<Layers3 size={13} class="text-zinc-400" />
								{formatNumber(plate.layerCount)}
								{$t('plates.layerCount')}
							</span>
						{/if}
						<span class="text-zinc-400">
							{$t('plates.totalWeight', { values: { weight: formatNumber(totalWeight(index), 1) } })}
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

					{#if plate.objects.length > 0}
						<div class="mt-4 border-t border-white/5 pt-4">
							<p class="text-xs font-medium text-zinc-300">{$t('plates.assignParts')}</p>
							<p class="mt-1 text-[11px] leading-relaxed text-zinc-400">
								{$t('plates.assignPartsHint')}
							</p>

							<ul class="mt-3 grid gap-2">
								{#each plate.objects as object, objectIndex (object.name)}
									<li class="flex items-center gap-3">
										<span class="min-w-0 flex-1 truncate text-xs text-zinc-300">
											{object.name}
										</span>
										<span class="shrink-0 text-[11px] text-zinc-400 tabular-nums">
											{object.quantity}× {$t('units.pieces')}
										</span>
										<select class="input-base h-8 w-52 shrink-0 py-0 text-xs" bind:value={mappings[index][objectIndex]}>
											<option value="create">{$t('parts.add')}</option>
											{#each parts as part (part.id)}
												<option value={part.id}>{part.name}</option>
											{/each}
											<option value={0}>{$t('common.none')}</option>
										</select>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		<Button variant="primary" onclick={importPlates} disabled={busy}>
			{busy ? $t('common.saving') : $t('common.add')}
		</Button>
	{/snippet}
</Modal>
