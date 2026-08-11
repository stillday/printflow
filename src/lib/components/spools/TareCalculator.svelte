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
	}

	let { tareWeight, onApply }: Props = $props();

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
			<input class="input-base" bind:value={scaleInput} inputmode="decimal" placeholder="0" />
		</Field>
		<Field label="{$t('spools.tare.tareWeight')} ({$t('units.gram')})">
			<input
				class="input-base"
				bind:value={tareInput}
				inputmode="decimal"
				oninput={() => (tareTouched = true)}
			/>
		</Field>
	</div>

	<div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
		<div class="min-w-0">
			<p class="text-[10px] tracking-widest text-zinc-400 uppercase">
				{$t('spools.tare.formula')}
			</p>
			<p
				class="mt-0.5 text-lg font-semibold tabular-nums {negative
					? 'text-rose-400'
					: 'text-emerald-400'}"
			>
				{ready ? formatGrams(net) : '–'}
			</p>
			{#if negative}
				<p class="mt-1 text-xs text-rose-400">{$t('spools.tare.negative')}</p>
			{/if}
		</div>
		<Button
			variant="secondary"
			size="sm"
			disabled={!ready || negative}
			onclick={() => onApply(Math.round(net * 10) / 10)}
		>
			{$t('spools.tare.apply')}
		</Button>
	</div>
</div>
