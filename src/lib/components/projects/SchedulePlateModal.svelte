<script lang="ts">
	import { t } from 'svelte-i18n';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import { createEntry } from '$lib/db/plan';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { PrintPlateDecoded } from '$lib/types/schema';
	import { formatDuration } from '$lib/utils/format';
	import { addPlanDays, parsePlanDate, todayPlanDate } from '$lib/utils/plan';

	interface Props {
		plate: PrintPlateDecoded | null;
		onClose: () => void;
		onScheduled: () => void;
	}

	let { plate, onClose, onScheduled }: Props = $props();

	let dateInput = $state(todayPlanDate());
	let note = $state('');
	let busy = $state(false);

	const durationLabels = $derived({
		day: $t('units.daysShort'),
		hour: $t('units.hoursShort'),
		minute: $t('units.minutesShort')
	});

	$effect(() => {
		if (plate) {
			dateInput = todayPlanDate();
			note = '';
		}
	});

	const valid = $derived(parsePlanDate(dateInput) !== null);

	/** One-tap choices cover almost every case; the field stays for the rest. */
	const quickDates = $derived([
		{ labelKey: 'plan.today', date: todayPlanDate() },
		{ labelKey: 'plan.tomorrow', date: addPlanDays(todayPlanDate(), 1) },
		{ labelKey: 'plan.inAWeek', date: addPlanDays(todayPlanDate(), 7) }
	]);

	async function schedule() {
		if (!plate?.id || !valid || busy) return;
		busy = true;
		try {
			await createEntry(plate.id, dateInput, note);
			toasts.success('toast.scheduled');
			onScheduled();
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
	title={$t('plan.scheduleTitle')}
	subtitle={plate?.name}
	size="sm"
	{onClose}
>
	{#if plate}
		<div class="grid gap-5">
			<div
				class="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-950/50 px-4 py-3"
			>
				<span class="text-xs tracking-wide text-zinc-400 uppercase">
					{$t('plates.estimatedTime')}
				</span>
				<span class="text-sm font-semibold text-zinc-100 tabular-nums">
					{formatDuration(plate.estimatedTimeSeconds, durationLabels)}
				</span>
			</div>

			<Field label={$t('plan.date')}>
				<input
					class="input-base"
					type="date"
					bind:value={dateInput}
					data-autofocus
					onkeydown={(event) => event.key === 'Enter' && schedule()}
				/>
			</Field>

			<div class="flex flex-wrap gap-2">
				{#each quickDates as choice (choice.labelKey)}
					<Button
						variant={dateInput === choice.date ? 'primary' : 'secondary'}
						size="sm"
						onclick={() => (dateInput = choice.date)}
					>
						{$t(choice.labelKey)}
					</Button>
				{/each}
			</div>

			<Field label={$t('plan.note')} optional>
				<input class="input-base" bind:value={note} placeholder={$t('plan.notePlaceholder')} />
			</Field>
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		<Button variant="primary" onclick={schedule} disabled={!valid || busy}>
			{$t('plan.schedule')}
		</Button>
	{/snippet}
</Modal>
