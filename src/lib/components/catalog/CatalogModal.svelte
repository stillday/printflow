<script lang="ts">
	import { t } from 'svelte-i18n';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import { createCatalog, updateCatalog } from '$lib/db/catalog';
	import { toasts } from '$lib/stores/toast.svelte';
	import { COMMON_MATERIALS, MATERIAL_DENSITIES, type FilamentCatalog } from '$lib/types/schema';
	import { DEFAULT_FILAMENT_COLOR, normalizeHex, rgbaFromHex } from '$lib/utils/color';
	import { isValid, positiveNumber, requiredText, toNumber } from '$lib/utils/validate';

	interface Props {
		open: boolean;
		/** `null` opens the form empty for a new entry. */
		entry: FilamentCatalog | null;
		onClose: () => void;
		onSaved: () => void;
	}

	let { open, entry, onClose, onSaved }: Props = $props();

	function blank(): FilamentCatalog {
		return {
			brand: '',
			material: 'PLA',
			name: '',
			colorHex: DEFAULT_FILAMENT_COLOR,
			density: MATERIAL_DENSITIES.PLA,
			spoolTareWeight: 250,
			nominalWeight: 1000,
			printingTempMin: null,
			printingTempMax: null
		};
	}

	let form = $state<FilamentCatalog>(blank());
	let densityInput = $state('1.24');
	let tareInput = $state('250');
	let nominalInput = $state('1000');
	let tempMinInput = $state('');
	let tempMaxInput = $state('');
	let submitted = $state(false);
	let busy = $state(false);

	// Re-seed whenever the dialog opens, so a cancelled edit leaves no residue.
	$effect(() => {
		if (!open) return;
		const source = entry ?? blank();
		form = { ...source };
		densityInput = String(source.density);
		tareInput = String(source.spoolTareWeight);
		nominalInput = String(source.nominalWeight);
		tempMinInput = source.printingTempMin != null ? String(source.printingTempMin) : '';
		tempMaxInput = source.printingTempMax != null ? String(source.printingTempMax) : '';
		submitted = false;
	});

	const errors = $derived({
		brand: requiredText(form.brand),
		name: requiredText(form.name),
		material: requiredText(form.material),
		density: positiveNumber(toNumber(densityInput)),
		spoolTareWeight: positiveNumber(toNumber(tareInput)),
		nominalWeight: positiveNumber(toNumber(nominalInput))
	});

	/** Only surface validation errors once the user has tried to save. */
	const shown = $derived(
		submitted ? errors : ({} as Partial<Record<keyof typeof errors, string | null>>)
	);

	function onMaterialChange(value: string) {
		form.material = value;
		const density = MATERIAL_DENSITIES[value];
		// Only auto-fill for a brand-new entry — never overwrite a saved value.
		if (density && !entry) densityInput = String(density);
	}

	async function save() {
		submitted = true;
		if (!isValid(errors) || busy) return;

		busy = true;
		try {
			const payload: FilamentCatalog = {
				...form,
				colorHex: normalizeHex(form.colorHex) ?? DEFAULT_FILAMENT_COLOR,
				density: toNumber(densityInput),
				spoolTareWeight: toNumber(tareInput),
				nominalWeight: toNumber(nominalInput),
				printingTempMin: tempMinInput.trim() ? Math.round(toNumber(tempMinInput)) : null,
				printingTempMax: tempMaxInput.trim() ? Math.round(toNumber(tempMaxInput)) : null
			};

			if (payload.id) {
				await updateCatalog(payload);
				toasts.success('toast.updated');
			} else {
				await createCatalog(payload);
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
	title={entry ? $t('catalog.edit') : $t('catalog.add')}
	subtitle={$t('catalog.subtitle')}
	{onClose}
>
	<form
		class="grid gap-5 sm:grid-cols-2"
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		<Field label={$t('catalog.fields.brand')} error={shown.brand}>
			<input
				class="input-base"
				bind:value={form.brand}
				placeholder={$t('catalog.fields.brandPlaceholder')}
				data-autofocus
			/>
		</Field>

		<Field label={$t('catalog.fields.name')} error={shown.name}>
			<input
				class="input-base"
				bind:value={form.name}
				placeholder={$t('catalog.fields.namePlaceholder')}
			/>
		</Field>

		<Field label={$t('catalog.fields.material')} error={shown.material}>
			<input
				class="input-base"
				list="pf-materials"
				value={form.material}
				oninput={(event) => onMaterialChange(event.currentTarget.value)}
			/>
			<datalist id="pf-materials">
				{#each COMMON_MATERIALS as material (material)}
					<option value={material}></option>
				{/each}
			</datalist>
		</Field>

		<Field label={$t('catalog.fields.colorHex')}>
			<div class="flex items-center gap-3">
				<label
					class="relative h-10 w-14 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-white/10"
					style="background-color: {normalizeHex(form.colorHex) ?? DEFAULT_FILAMENT_COLOR};
					       box-shadow: 0 0 16px {rgbaFromHex(form.colorHex, 0.5)}"
				>
					<span class="sr-only">{$t('catalog.fields.colorHex')}</span>
					<input
						type="color"
						class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
						bind:value={form.colorHex}
					/>
				</label>
				<input class="input-base font-mono" bind:value={form.colorHex} spellcheck="false" />
			</div>
		</Field>

		<Field
			label="{$t('catalog.fields.density')} ({$t('units.gramPerCubicCm')})"
			error={shown.density}
			hint={$t('catalog.fields.densityHint')}
		>
			<input class="input-base" bind:value={densityInput} inputmode="decimal" />
		</Field>

		<Field
			label="{$t('catalog.fields.spoolTareWeight')} ({$t('units.gram')})"
			error={shown.spoolTareWeight}
			hint={$t('catalog.fields.spoolTareWeightHint')}
		>
			<input class="input-base" bind:value={tareInput} inputmode="decimal" />
		</Field>

		<Field
			label="{$t('catalog.fields.nominalWeight')} ({$t('units.gram')})"
			error={shown.nominalWeight}
		>
			<input class="input-base" bind:value={nominalInput} inputmode="decimal" />
		</Field>

		<div class="grid grid-cols-2 gap-3">
			<Field label="{$t('catalog.fields.printingTempMin')} ({$t('units.celsius')})" optional>
				<input class="input-base" bind:value={tempMinInput} inputmode="numeric" />
			</Field>
			<Field label="{$t('catalog.fields.printingTempMax')} ({$t('units.celsius')})" optional>
				<input class="input-base" bind:value={tempMaxInput} inputmode="numeric" />
			</Field>
		</div>

		<!-- Lets Enter submit the form without a visible duplicate button. -->
		<button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
	</form>

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		<Button variant="primary" onclick={save} disabled={busy}>
			{busy ? $t('common.saving') : $t('common.save')}
		</Button>
	{/snippet}
</Modal>
