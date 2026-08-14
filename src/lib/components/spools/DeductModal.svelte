<script lang="ts">
	import { t } from 'svelte-i18n';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import TareCalculator from './TareCalculator.svelte';
	import { deductFromSpool, updateSpool } from '$lib/db/spools';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { SpoolWithCatalog } from '$lib/types/schema';
	import { formatGrams } from '$lib/utils/format';
	import { spoolTitle } from '$lib/utils/status';
	import { positiveNumber, toNumber } from '$lib/utils/validate';

	interface Props {
		spool: SpoolWithCatalog | null;
		onClose: () => void;
		onSaved: () => void;
	}

	let { spool, onClose, onSaved }: Props = $props();

	let amountInput = $state('');
	let busy = $state(false);
	let submitted = $state(false);
	let amountEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (!spool) return;
		amountInput = '';
		submitted = false;
	});

	const amount = $derived(toNumber(amountInput));
	const error = $derived(positiveNumber(amount));
	const valid = $derived(error === null);
	/** Only surface the message once the user has tried, like in the other forms. */
	const shownError = $derived(submitted ? error : null);
	const remaining = $derived(
		spool && valid ? Math.max(0, spool.currentWeightNet - amount) : (spool?.currentWeightNet ?? 0)
	);

	async function deduct() {
		submitted = true;
		// The button stays enabled and the click is what explains the problem: a
		// greyed-out button next to `abc` or `0` left the user with nothing to read.
		// No toast here — unlike the two big forms, the one field of this dialog is
		// always on screen, right where the focus lands.
		if (!valid) {
			amountEl?.focus();
			return;
		}
		if (!spool?.id || busy) return;
		busy = true;
		try {
			await deductFromSpool(spool.id, amount);
			toasts.success('toast.spoolDeducted', {
				amount: formatGrams(amount),
				name: spoolTitle(spool)
			});
			onSaved();
			onClose();
		} catch {
			toasts.error('errors.saveFailed');
		} finally {
			busy = false;
		}
	}

	/** The tare calculator yields a *remaining* weight, not an amount used. */
	async function applyMeasured(net: number) {
		if (!spool?.id || busy) return;
		busy = true;
		try {
			await updateSpool({ ...spool, currentWeightNet: Math.max(0, net) });
			toasts.success('toast.updated');
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
	open={spool !== null}
	title={$t('spools.deductTitle')}
	subtitle={spool ? spoolTitle(spool) : undefined}
	size="md"
	{onClose}
>
	{#if spool}
		<div class="grid gap-5">
			<div class="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-950/50 px-4 py-3">
				<span class="text-xs tracking-wide text-zinc-400 uppercase">{$t('spools.remaining')}</span>
				<span class="text-sm font-semibold text-zinc-100 tabular-nums">
					{formatGrams(spool.currentWeightNet)}
					{#if valid}
						<span class="text-zinc-400"> → </span>
						<span class={remaining <= 0 ? 'text-rose-400' : 'text-emerald-400'}>
							{formatGrams(remaining)}
						</span>
					{/if}
				</span>
			</div>

			<Field
				label="{$t('spools.deductAmount')} ({$t('units.gram')})"
				error={shownError}
				hint={$t('spools.deductHint')}
			>
				<input
					bind:this={amountEl}
					class="input-base"
					bind:value={amountInput}
					inputmode="decimal"
					placeholder="0"
					data-autofocus
					onkeydown={(event) => event.key === 'Enter' && deduct()}
				/>
			</Field>

			<TareCalculator
				tareWeight={spool.catalog.spoolTareWeight}
				nominalWeight={spool.catalog.nominalWeight}
				applyLabelKey="spools.tare.applyAsRemaining"
				onApply={applyMeasured}
			/>
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		<Button variant="primary" onclick={deduct} disabled={busy}>
			{$t('spools.deduct')}
		</Button>
	{/snippet}
</Modal>
