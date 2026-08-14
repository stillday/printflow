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
	let formEl = $state<HTMLFormElement | null>(null);
	/**
	 * Whether the "please check the fields" toast has already been shown.
	 *
	 * Error toasts stay until they are dismissed, so a second copy of the same
	 * sentence would only stack up next to the first. Every further failed
	 * attempt still reports itself by moving the focus and by the field message.
	 */
	let announced = $state(false);

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
		announced = false;
	});

	/** Optional field: empty is a valid answer, anything else has to be a number. */
	function optionalNumber(value: string): string | null {
		if (!value.trim()) return null;
		return Number.isFinite(toNumber(value)) ? null : 'errors.invalidNumber';
	}

	const tempMin = $derived(tempMinInput.trim() ? toNumber(tempMinInput) : null);
	const tempMax = $derived(tempMaxInput.trim() ? toNumber(tempMaxInput) : null);

	const errors = $derived({
		brand: requiredText(form.brand),
		name: requiredText(form.name),
		material: requiredText(form.material),
		// The hex box takes free text. Without this, "blau" was accepted and then
		// silently saved as the fallback indigo — the swatch changed, nothing said why.
		colorHex: normalizeHex(form.colorHex) ? null : 'errors.invalidColor',
		density: positiveNumber(toNumber(densityInput)),
		spoolTareWeight: positiveNumber(toNumber(tareInput)),
		nominalWeight: positiveNumber(toNumber(nominalInput)),
		printingTempMin: optionalNumber(tempMinInput),
		// A swapped range would be stored as typed and read back as "260–240 °C".
		printingTempMax:
			optionalNumber(tempMaxInput) ??
			(tempMin !== null && tempMax !== null && tempMax < tempMin ? 'errors.minAboveMax' : null)
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

	/**
	 * Sends the user to the first field they still have to fix.
	 *
	 * Queried in DOM order instead of in the order of the error map, so the field
	 * the eye reaches first is also the one that gets the caret.
	 */
	function focusFirstError() {
		const selector = Object.entries(errors)
			.filter(([, message]) => message !== null)
			.map(([key]) => `[data-field="${key}"]`)
			.join(', ');
		if (!selector) return;

		const control = formEl?.querySelector<HTMLElement>(selector);
		// Focus without scrolling, then centre by hand: the browser's own focus
		// scroll stops as soon as the field is barely inside the dialog, which in
		// this nine-field grid often means half-hidden behind the header.
		control?.focus({ preventScroll: true });
		control?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	async function save() {
		submitted = true;
		if (!isValid(errors)) {
			// Nine fields in a two-column grid inside a scrolling dialog: the invalid
			// one is regularly off-screen, and marking it alone makes Save look dead.
			focusFirstError();
			if (!announced) {
				toasts.error('errors.formInvalid');
				announced = true;
			}
			return;
		}
		if (busy) return;

		busy = true;
		try {
			const payload: FilamentCatalog = {
				...form,
				colorHex: normalizeHex(form.colorHex) ?? DEFAULT_FILAMENT_COLOR,
				density: toNumber(densityInput),
				spoolTareWeight: toNumber(tareInput),
				nominalWeight: toNumber(nominalInput),
				printingTempMin: tempMin !== null ? Math.round(tempMin) : null,
				printingTempMax: tempMax !== null ? Math.round(tempMax) : null
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
		bind:this={formEl}
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
				data-field="brand"
				data-autofocus
			/>
		</Field>

		<Field label={$t('catalog.fields.name')} error={shown.name}>
			<input
				class="input-base"
				bind:value={form.name}
				placeholder={$t('catalog.fields.namePlaceholder')}
				data-field="name"
			/>
		</Field>

		<Field label={$t('catalog.fields.material')} error={shown.material}>
			<input
				class="input-base"
				list="pf-materials"
				value={form.material}
				oninput={(event) => onMaterialChange(event.currentTarget.value)}
				data-field="material"
			/>
			<datalist id="pf-materials">
				{#each COMMON_MATERIALS as material (material)}
					<option value={material}></option>
				{/each}
			</datalist>
		</Field>

		<Field label={$t('catalog.fields.colorHex')} error={shown.colorHex}>
			<div class="flex items-center gap-3">
				<!--
					A <span>, not a <label>: `Field` wraps its children in a label of its
					own, and a label inside a label is invalid — which control the caption
					then belongs to is up to the browser. The swatch is purely the
					clickable surface of the colour input lying transparently on top of
					it, so it needs no caption; the picker is named by `Field`, being the
					first control inside it, and the hex box carries its own name.
				-->
				<span
					class="relative h-10 w-14 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-white/10"
					style="background-color: {normalizeHex(form.colorHex) ?? DEFAULT_FILAMENT_COLOR};
					       box-shadow: 0 0 16px {rgbaFromHex(form.colorHex, 0.5)}"
				>
					<input
						type="color"
						class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
						bind:value={form.colorHex}
					/>
				</span>
				<input
					class="input-base font-mono"
					bind:value={form.colorHex}
					spellcheck="false"
					placeholder="#rrggbb"
					aria-label={$t('catalog.fields.colorHex')}
					data-field="colorHex"
				/>
			</div>
		</Field>

		<Field
			label="{$t('catalog.fields.density')} ({$t('units.gramPerCubicCm')})"
			error={shown.density}
			hint={$t('catalog.fields.densityHint')}
		>
			<input
				class="input-base"
				bind:value={densityInput}
				inputmode="decimal"
				data-field="density"
			/>
		</Field>

		<Field
			label="{$t('catalog.fields.spoolTareWeight')} ({$t('units.gram')})"
			error={shown.spoolTareWeight}
			hint={$t('catalog.fields.spoolTareWeightHint')}
		>
			<input
				class="input-base"
				bind:value={tareInput}
				inputmode="decimal"
				data-field="spoolTareWeight"
			/>
		</Field>

		<Field
			label="{$t('catalog.fields.nominalWeight')} ({$t('units.gram')})"
			error={shown.nominalWeight}
			hint={$t('catalog.fields.nominalWeightHint')}
		>
			<input
				class="input-base"
				bind:value={nominalInput}
				inputmode="decimal"
				data-field="nominalWeight"
			/>
		</Field>

		<div class="grid grid-cols-2 gap-3">
			<Field
				label="{$t('catalog.fields.printingTempMin')} ({$t('units.celsius')})"
				error={shown.printingTempMin}
				optional
			>
				<input
					class="input-base"
					bind:value={tempMinInput}
					inputmode="numeric"
					data-field="printingTempMin"
				/>
			</Field>
			<Field
				label="{$t('catalog.fields.printingTempMax')} ({$t('units.celsius')})"
				error={shown.printingTempMax}
				optional
			>
				<input
					class="input-base"
					bind:value={tempMaxInput}
					inputmode="numeric"
					data-field="printingTempMax"
				/>
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
