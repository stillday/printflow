<script lang="ts">
	import { t } from 'svelte-i18n';
	import { Calculator } from '@lucide/svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import { formatGrams } from '$lib/utils/format';
	import { toNumber } from '$lib/utils/validate';

	interface Props {
		/** Pre-filled from the selected filament's catalog entry. */
		tareWeight: number;
		/** Called with the computed net weight when the user applies it. */
		onApply: (netWeight: number) => void;
		/**
		 * What applying actually does, which differs by caller: in the spool form
		 * it fills a field, in the deduct dialog it writes the new remaining
		 * weight straight to the database. One shared label for both would have
		 * been the same word for a reversible and an irreversible action.
		 */
		applyLabelKey?: string;
		/** Nominal spool weight, to catch a mistyped tare. */
		nominalWeight?: number;
		/**
		 * Whether Enter may apply. False where applying *commits* — in the deduct
		 * dialog it writes the remaining weight and closes, and Enter one field
		 * higher means "deduct this amount", so the same key would mean two very
		 * different things in one dialog.
		 */
		applyOnEnter?: boolean;
	}

	let {
		tareWeight,
		onApply,
		applyLabelKey = 'spools.tare.apply',
		nominalWeight,
		applyOnEnter = true
	}: Props = $props();

	let scaleInput = $state('');
	// Seeded by the effect below rather than inline, so it tracks `tareWeight`.
	let tareInput = $state('');

	// Follow the catalog whenever the user picks a different filament, but only
	// while they have not typed their own tare value.
	let tareTouched = $state(false);
	$effect(() => {
		if (!tareTouched) tareInput = String(tareWeight);
	});

	const scale = $derived(toNumber(scaleInput));
	const tare = $derived(toNumber(tareInput));
	const net = $derived(Number.isNaN(scale) || Number.isNaN(tare) ? Number.NaN : scale - tare);
	const ready = $derived(Number.isFinite(net));
	const negative = $derived(ready && net < 0);
	/**
	 * Something is typed but unusable. Without this the result just reads "–" and
	 * the apply button stays greyed out, with nothing pointing at the field that
	 * caused it — the same dead end the deduct dialog used to have.
	 */
	const malformed = $derived(
		[scaleInput, tareInput].some(
			(value) => value.trim() !== '' && !Number.isFinite(toNumber(value))
		)
	);
	/**
	 * A tare typed as 25 instead of 250 yields more filament than the spool ever
	 * held, and nothing downstream would question it — `fillRatio` just clamps.
	 */
	const implausible = $derived(
		ready && !negative && nominalWeight !== undefined && net > nominalWeight * 1.05
	);

	function apply() {
		if (!ready || negative) return;
		onApply(Math.round(net * 10) / 10);
	}

	/**
	 * These inputs sit inside the spool form, whose hidden submit button would
	 * otherwise catch Enter and save the spool with the *old* weight, silently
	 * discarding the calculation the user just typed.
	 */
	function onEnter(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		// Still swallow the key: letting it through would submit the surrounding
		// spool form with the *old* weight, discarding the calculation.
		event.preventDefault();
		if (applyOnEnter) apply();
	}
</script>

<div class="rounded-xl border border-white/10 bg-zinc-950/50 p-4">
	<div class="mb-4 flex items-center gap-2">
		<Calculator size={15} class="text-indigo-400" />
		<div class="min-w-0">
			<p class="text-xs font-semibold text-zinc-200">{$t('spools.tare.title')}</p>
			<p class="text-[11px] text-zinc-400">{$t('spools.tare.subtitle')}</p>
		</div>
	</div>

	<div class="grid gap-3 sm:grid-cols-2">
		<Field
			label="{$t('spools.tare.scaleWeight')} ({$t('units.gram')})"
			hint={$t('spools.tare.scaleWeightHint')}
		>
			<input
				class="input-base"
				bind:value={scaleInput}
				inputmode="decimal"
				placeholder="0"
				onkeydown={onEnter}
			/>
		</Field>
		<Field label="{$t('spools.tare.tareWeight')} ({$t('units.gram')})">
			<input
				class="input-base"
				bind:value={tareInput}
				inputmode="decimal"
				oninput={() => (tareTouched = true)}
				onkeydown={onEnter}
			/>
		</Field>
	</div>

	<div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
		<div class="min-w-0">
			<p class="text-[10px] tracking-widest text-zinc-400 uppercase">
				{$t('spools.tare.result')}
			</p>
			<p
				class="mt-0.5 text-lg font-semibold tabular-nums {negative
					? 'text-rose-400'
					: 'text-emerald-400'}"
			>
				{ready ? formatGrams(net) : '–'}
			</p>
			<p class="mt-0.5 text-[11px] text-zinc-400">{$t('spools.tare.formula')}</p>
			{#if negative}
				<p class="mt-1 text-xs text-rose-400">{$t('spools.tare.negative')}</p>
			{:else if malformed}
				<p class="mt-1 text-xs text-rose-400">{$t('errors.invalidNumber')}</p>
			{:else if implausible}
				<p class="mt-1 text-xs text-amber-300">
					{$t('spools.tare.implausible', { values: { nominal: formatGrams(nominalWeight ?? 0) } })}
				</p>
			{/if}
		</div>
		<Button variant="secondary" size="sm" disabled={!ready || negative} onclick={apply}>
			{$t(applyLabelKey)}
		</Button>
	</div>
</div>
