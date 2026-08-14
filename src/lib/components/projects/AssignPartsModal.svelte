<script lang="ts">
	import { t } from 'svelte-i18n';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { renamePlate, setPartsOnPlate } from '$lib/db/plates';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { Part, PrintPlateDecoded } from '$lib/types/schema';
	import { cn } from '$lib/utils/cn';

	interface Props {
		plate: PrintPlateDecoded | null;
		parts: Part[];
		onClose: () => void;
		onSaved: () => void;
	}

	let { plate, parts, onClose, onSaved }: Props = $props();

	let name = $state('');
	/** Quantity per part id; 0 means "not on this plate". */
	let quantities = $state<Record<number, number>>({});
	let filter = $state('');
	let busy = $state(false);

	/** Long lists need a way in — below this the filter is just noise. */
	const FILTER_THRESHOLD = 8;
	const showFilter = $derived(parts.length > FILTER_THRESHOLD);

	$effect(() => {
		if (!plate) return;
		name = plate.name;
		filter = '';
		const next: Record<number, number> = {};
		for (const part of parts) {
			if (part.id === undefined) continue;
			next[part.id] = plate.partsOnPlate.find((entry) => entry.partId === part.id)?.quantityOnPlate ?? 0;
		}
		quantities = next;
	});

	/**
	 * Parts already on the plate first, everything else after, each group in the
	 * project's own order. The order is keyed off the *stored* assignment, not
	 * off `quantities`, so rows do not jump around under the cursor while a
	 * quantity is being typed.
	 */
	const ordered = $derived.by(() => {
		if (!plate) return [];
		const onPlate = new Set(plate.partsOnPlate.map((entry) => entry.partId));
		// `sort` is stable, so this only lifts the assigned ones to the top.
		return [...parts].sort(
			(a, b) => Number(!onPlate.has(a.id!)) - Number(!onPlate.has(b.id!))
		);
	});

	const visible = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		if (!needle) return ordered;
		return ordered.filter((part) => part.name.toLowerCase().includes(needle));
	});

	async function save() {
		if (!plate?.id || busy) return;
		busy = true;
		try {
			const assignments = Object.entries(quantities)
				.map(([partId, quantityOnPlate]) => ({ partId: Number(partId), quantityOnPlate }))
				.filter((entry) => entry.quantityOnPlate > 0);

			await setPartsOnPlate(plate.id, assignments);
			if (name.trim() && name.trim() !== plate.name) {
				await renamePlate(plate.id, name);
			}
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
	open={plate !== null}
	title={$t('plates.assignParts')}
	subtitle={$t('plates.assignPartsHint')}
	{onClose}
>
	{#if plate}
		<div class="grid gap-5">
			<!-- Renaming lives on the card itself now; kept here as a convenience,
			     but it no longer takes the dialog's focus. -->
			<label class="block">
				<span class="label-base">{$t('plates.rename')}</span>
				<input class="input-base" bind:value={name} />
			</label>

			{#if parts.length === 0}
				<p class="text-sm text-zinc-400">{$t('parts.empty')}</p>
			{:else}
				<div>
					<span class="label-base">{$t('plates.quantityOnPlate')}</span>

					{#if showFilter}
						<input
							class="input-base mb-2"
							type="search"
							bind:value={filter}
							placeholder={$t('plates.filterParts')}
							aria-label={$t('plates.filterParts')}
							data-autofocus
						/>
					{/if}

					{#if visible.length === 0}
						<p class="text-sm text-zinc-400">{$t('common.noResults')}</p>
					{:else}
						<ul class="grid max-h-80 gap-2 overflow-y-auto">
							{#each visible as part, index (part.id)}
								{@const assigned = (quantities[part.id!] ?? 0) > 0}
								<li
									class={cn(
										'flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors',
										assigned
											? 'border-indigo-500/40 bg-indigo-500/10'
											: 'border-white/10 bg-zinc-950/40'
									)}
								>
									<span class="min-w-0 flex-1 truncate text-sm text-zinc-200">{part.name}</span>
									<span class="shrink-0 text-xs text-zinc-400 tabular-nums">
										{part.printedQuantity}/{part.requiredQuantity}
									</span>
									<input
										class="input-base h-8 w-20 shrink-0 py-0 text-center tabular-nums"
										type="number"
										min="0"
										step="1"
										aria-label={part.name}
										value={quantities[part.id!] ?? 0}
										data-autofocus={!showFilter && index === 0 ? true : undefined}
										oninput={(event) => {
											const parsed = Number.parseInt(event.currentTarget.value, 10);
											quantities[part.id!] = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
										}}
									/>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		<Button variant="primary" onclick={save} disabled={busy}>{$t('common.save')}</Button>
	{/snippet}
</Modal>
