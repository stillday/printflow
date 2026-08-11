<script lang="ts">
	import { t } from 'svelte-i18n';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { renamePlate, setPartsOnPlate } from '$lib/db/plates';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { Part, PrintPlateDecoded } from '$lib/types/schema';

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
	let busy = $state(false);

	$effect(() => {
		if (!plate) return;
		name = plate.name;
		const next: Record<number, number> = {};
		for (const part of parts) {
			if (part.id === undefined) continue;
			next[part.id] = plate.partsOnPlate.find((entry) => entry.partId === part.id)?.quantityOnPlate ?? 0;
		}
		quantities = next;
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
			<label class="block">
				<span class="label-base">{$t('plates.rename')}</span>
				<input class="input-base" bind:value={name} data-autofocus />
			</label>

			{#if parts.length === 0}
				<p class="text-sm text-zinc-400">{$t('parts.empty')}</p>
			{:else}
				<div>
					<span class="label-base">{$t('plates.quantityOnPlate')}</span>
					<ul class="grid gap-2">
						{#each parts as part (part.id)}
							<li
								class="flex items-center gap-3 rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-2"
							>
								<span class="min-w-0 flex-1 truncate text-sm text-zinc-200">{part.name}</span>
								<span class="shrink-0 text-[11px] text-zinc-400 tabular-nums">
									{part.printedQuantity}/{part.requiredQuantity}
								</span>
								<input
									class="input-base h-8 w-20 shrink-0 py-0 text-center tabular-nums"
									type="number"
									min="0"
									step="1"
									aria-label={part.name}
									value={quantities[part.id!] ?? 0}
									oninput={(event) => {
										const parsed = Number.parseInt(event.currentTarget.value, 10);
										quantities[part.id!] = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
									}}
								/>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		<Button variant="primary" onclick={save} disabled={busy}>{$t('common.save')}</Button>
	{/snippet}
</Modal>
