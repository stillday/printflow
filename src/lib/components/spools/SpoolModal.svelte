<script lang="ts">
	import { t } from 'svelte-i18n';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import ColorSwatch from '$lib/components/ui/ColorSwatch.svelte';
	import TareCalculator from './TareCalculator.svelte';
	import { createSpool, updateSpool } from '$lib/db/spools';
	import { toasts } from '$lib/stores/toast.svelte';
	import {
		SPOOL_STATUSES,
		type FilamentCatalog,
		type Spool,
		type SpoolStatus,
		type SpoolWithCatalog
	} from '$lib/types/schema';
	import { fromDateInputValue, toDateInputValue } from '$lib/utils/format';
	import { isValid, nonNegativeNumber, toNumber } from '$lib/utils/validate';

	interface Props {
		open: boolean;
		spool: SpoolWithCatalog | null;
		catalog: FilamentCatalog[];
		onClose: () => void;
		onSaved: () => void;
	}

	let { open, spool, catalog, onClose, onSaved }: Props = $props();

	let catalogId = $state(0);
	let weightInput = $state('');
	let costInput = $state('0');
	let location = $state('');
	let code = $state('');
	let status = $state<SpoolStatus>('active');
	let openedAt = $state('');
	let submitted = $state(false);
	let busy = $state(false);
	let showTare = $state(false);

	$effect(() => {
		if (!open) return;
		catalogId = spool?.catalogId ?? catalog[0]?.id ?? 0;
		// A new spool starts full, which is what the nominal weight means.
		weightInput = String(spool?.currentWeightNet ?? catalog[0]?.nominalWeight ?? 1000);
		costInput = String(spool?.cost ?? 0);
		location = spool?.location ?? '';
		code = spool?.qrOrBarCode ?? '';
		status = spool?.status ?? 'active';
		openedAt = toDateInputValue(spool?.openedAt ?? new Date().toISOString());
		submitted = false;
		showTare = false;
	});

	const selectedCatalog = $derived(catalog.find((entry) => entry.id === catalogId) ?? null);

	// Picking a different filament for a *new* spool re-seeds the full weight.
	let lastCatalogId = $state(0);
	$effect(() => {
		if (!open || spool || catalogId === lastCatalogId) return;
		lastCatalogId = catalogId;
		const entry = catalog.find((item) => item.id === catalogId);
		if (entry) weightInput = String(entry.nominalWeight);
	});

	const errors = $derived({
		catalogId: catalogId > 0 ? null : 'errors.required',
		currentWeightNet: nonNegativeNumber(toNumber(weightInput)),
		cost: nonNegativeNumber(toNumber(costInput))
	});
	const shown = $derived(
		submitted ? errors : ({} as Partial<Record<keyof typeof errors, string | null>>)
	);

	async function save() {
		submitted = true;
		if (!isValid(errors) || busy) return;

		busy = true;
		try {
			const payload: Spool = {
				id: spool?.id,
				catalogId,
				qrOrBarCode: code,
				currentWeightNet: toNumber(weightInput),
				cost: toNumber(costInput),
				location,
				status,
				openedAt: fromDateInputValue(openedAt)
			};

			if (payload.id) {
				await updateSpool(payload);
				toasts.success('toast.updated');
			} else {
				await createSpool(payload);
				toasts.success('toast.created');
			}
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
	{open}
	title={spool ? $t('spools.edit') : $t('spools.add')}
	subtitle={$t('spools.subtitle')}
	{onClose}
>
	<form
		class="grid gap-5"
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		<Field label={$t('spools.fields.catalog')} error={shown.catalogId}>
			<div class="flex items-center gap-3">
				<ColorSwatch color={selectedCatalog?.colorHex} size={18} />
				<select class="input-base" bind:value={catalogId} data-autofocus>
					{#each catalog as entry (entry.id)}
						<option value={entry.id}>
							{entry.brand} · {entry.name} ({entry.material})
						</option>
					{/each}
				</select>
			</div>
		</Field>

		<div class="grid gap-5 sm:grid-cols-2">
			<Field
				label="{$t('spools.fields.currentWeightNet')} ({$t('units.gram')})"
				error={shown.currentWeightNet}
				hint={$t('spools.fields.currentWeightNetHint')}
			>
				<input class="input-base" bind:value={weightInput} inputmode="decimal" />
			</Field>

			<Field label={$t('spools.cost')} error={shown.cost} optional>
				<input class="input-base" bind:value={costInput} inputmode="decimal" />
			</Field>
		</div>

		{#if showTare}
			<TareCalculator
				tareWeight={selectedCatalog?.spoolTareWeight ?? 250}
				onApply={(net) => {
					weightInput = String(net);
					showTare = false;
				}}
			/>
		{:else}
			<div>
				<Button variant="ghost" size="sm" onclick={() => (showTare = true)}>
					{$t('spools.tare.open')}
				</Button>
			</div>
		{/if}

		<div class="grid gap-5 sm:grid-cols-2">
			<Field label={$t('spools.location')} optional>
				<input
					class="input-base"
					bind:value={location}
					placeholder={$t('spools.locationPlaceholder')}
				/>
			</Field>

			<Field label={$t('spools.code')} optional>
				<input class="input-base" bind:value={code} spellcheck="false" />
			</Field>

			<Field label={$t('spools.filterStatus')}>
				<select class="input-base" bind:value={status}>
					{#each SPOOL_STATUSES as value (value)}
						<option {value}>{$t(`status.${value}`)}</option>
					{/each}
				</select>
			</Field>

			<Field label={$t('spools.openedAt')} optional>
				<input class="input-base" type="date" bind:value={openedAt} />
			</Field>
		</div>

		<button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
	</form>

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		<Button variant="primary" onclick={save} disabled={busy}>
			{busy ? $t('common.saving') : $t('common.save')}
		</Button>
	{/snippet}
</Modal>
