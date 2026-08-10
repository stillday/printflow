<script lang="ts">
	import { t } from 'svelte-i18n';
	import { CircleCheck, CircleX, TriangleAlert, Ban } from '@lucide/svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import ColorSwatch from '$lib/components/ui/ColorSwatch.svelte';
	import { logPrintJob } from '$lib/db/jobs';
	import { toasts } from '$lib/stores/toast.svelte';
	import type {
		JobStatus,
		Part,
		PrintPlateDecoded,
		SpoolAssignment,
		SpoolWithCatalog
	} from '$lib/types/schema';
	import { formatDuration, formatGrams } from '$lib/utils/format';
	import { spoolTitle } from '$lib/utils/status';
	import { cn } from '$lib/utils/cn';
	import { toNumber } from '$lib/utils/validate';

	interface Props {
		plate: PrintPlateDecoded | null;
		parts: Part[];
		spools: SpoolWithCatalog[];
		onClose: () => void;
		onLogged: () => void;
	}

	let { plate, parts, spools, onClose, onLogged }: Props = $props();

	/** Spool id chosen per filament slot; 0 means "none". */
	let selection = $state<number[]>([]);
	let status = $state<JobStatus>('success');
	let failureReason = $state('');
	let durationInput = $state('');
	let busy = $state(false);

	const durationLabels = $derived({
		day: $t('units.daysShort'),
		hour: $t('units.hoursShort'),
		minute: $t('units.minutesShort')
	});

	// Preselect, per slot, the active spool whose material matches and that has
	// the most filament left — the choice the user would almost always make.
	$effect(() => {
		if (!plate) return;
		selection = plate.filamentRequirements.map((requirement) => {
			const candidates = spools
				.filter((spool) => spool.status === 'active')
				.sort((a, b) => b.currentWeightNet - a.currentWeightNet);
			const sameMaterial = candidates.find(
				(spool) =>
					spool.catalog.material.toLowerCase() === requirement.materialType.toLowerCase() &&
					spool.currentWeightNet >= requirement.weightGrams
			);
			return sameMaterial?.id ?? candidates[0]?.id ?? 0;
		});
		status = 'success';
		failureReason = '';
		durationInput = '';
	});

	const activeSpools = $derived(spools.filter((spool) => spool.status === 'active'));

	const slots = $derived(
		(plate?.filamentRequirements ?? []).map((requirement, index) => {
			const spool = activeSpools.find((item) => item.id === selection[index]) ?? null;
			const available = spool?.currentWeightNet ?? 0;
			return {
				requirement,
				spool,
				available,
				after: Math.max(0, available - requirement.weightGrams),
				sufficient: spool !== null && available >= requirement.weightGrams
			};
		})
	);

	const hasShortage = $derived(
		status !== 'cancelled' && slots.some((slot) => slot.spool !== null && !slot.sufficient)
	);

	/** Parts that will be counted, resolved for the confirmation summary. */
	const affectedParts = $derived(
		(plate?.partsOnPlate ?? [])
			.map((entry) => ({
				part: parts.find((part) => part.id === entry.partId),
				quantity: entry.quantityOnPlate
			}))
			.filter((entry): entry is { part: Part; quantity: number } => entry.part !== undefined)
	);

	const outcomes: { value: JobStatus; labelKey: string; hintKey: string; icon: typeof CircleCheck }[] =
		[
			{
				value: 'success',
				labelKey: 'job.markSuccess',
				hintKey: 'job.markSuccessHint',
				icon: CircleCheck
			},
			{ value: 'failed', labelKey: 'job.markFailed', hintKey: 'job.markFailedHint', icon: CircleX },
			{
				value: 'cancelled',
				labelKey: 'job.markCancelled',
				hintKey: 'job.markCancelledHint',
				icon: Ban
			}
		];

	async function submit() {
		if (!plate || busy) return;
		busy = true;

		try {
			const minutes = toNumber(durationInput);
			const durationSeconds = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : null;
			const effectiveSeconds = durationSeconds ?? plate.estimatedTimeSeconds;

			const assignments: SpoolAssignment[] = slots
				.filter((slot) => slot.spool?.id)
				.map((slot) => ({
					slotIndex: slot.requirement.slotIndex,
					spoolId: slot.spool!.id!,
					weightGrams: slot.requirement.weightGrams
				}));

			// Jobs are logged after the fact, so derive the start from the runtime.
			const startedAt = new Date(Date.now() - effectiveSeconds * 1000).toISOString();

			await logPrintJob({
				plate,
				status,
				assignments,
				startedAt,
				actualDurationSeconds: durationSeconds,
				failureReason: status === 'failed' ? failureReason : null
			});

			toasts.success('toast.jobLogged');
			onLogged();
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
	title={$t('job.title')}
	subtitle={plate?.name}
	size="lg"
	{onClose}
>
	{#if plate}
		<div class="grid gap-6">
			<section>
				<h3 class="text-xs font-semibold text-zinc-200">{$t('job.assignSpools')}</h3>
				<p class="mt-1 text-[11px] leading-relaxed text-zinc-600">{$t('job.assignSpoolsHint')}</p>

				{#if activeSpools.length === 0}
					<p class="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
						{$t('job.noSpoolsAvailable')}
					</p>
				{:else if slots.length === 0}
					<p class="mt-3 text-xs text-zinc-600">{$t('plates.noFilamentData')}</p>
				{:else}
					<ul class="mt-3 grid gap-2">
						{#each slots as slot, index (slot.requirement.slotIndex)}
							<li class="rounded-xl border border-white/10 bg-zinc-950/40 p-3">
								<div class="flex flex-wrap items-center gap-3">
									<span
										class="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px]"
									>
										<ColorSwatch color={slot.requirement.colorHex} size={12} />
										{$t('plates.slot', { values: { index: slot.requirement.slotIndex } })}
									</span>

									<select class="input-base h-9 min-w-0 flex-1 py-0 text-xs" bind:value={selection[index]}>
										<option value={0}>{$t('job.noSpoolSelected')}</option>
										{#each activeSpools as spool (spool.id)}
											<option value={spool.id}>
												{spoolTitle(spool)} ({spool.catalog.material}) — {formatGrams(
													spool.currentWeightNet
												)}
											</option>
										{/each}
									</select>
								</div>

								<dl class="mt-3 grid grid-cols-3 gap-2 text-[11px]">
									<div>
										<dt class="text-zinc-600">{$t('job.needs')}</dt>
										<dd class="mt-0.5 text-zinc-300 tabular-nums">
											{formatGrams(slot.requirement.weightGrams)}
										</dd>
									</div>
									<div>
										<dt class="text-zinc-600">{$t('job.available')}</dt>
										<dd
											class={cn(
												'mt-0.5 tabular-nums',
												slot.spool && !slot.sufficient ? 'text-rose-400' : 'text-zinc-300'
											)}
										>
											{slot.spool ? formatGrams(slot.available) : '–'}
										</dd>
									</div>
									<div>
										<dt class="text-zinc-600">{$t('job.afterPrint')}</dt>
										<dd class="mt-0.5 text-zinc-300 tabular-nums">
											{slot.spool && status !== 'cancelled' ? formatGrams(slot.after) : '–'}
										</dd>
									</div>
								</dl>
							</li>
						{/each}
					</ul>
				{/if}

				{#if hasShortage}
					<div
						class="mt-3 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3"
					>
						<TriangleAlert size={16} class="mt-0.5 shrink-0 text-amber-400" />
						<p class="text-xs leading-relaxed text-amber-200">{$t('job.insufficientWarning')}</p>
					</div>
				{/if}
			</section>

			<section>
				<h3 class="mb-3 text-xs font-semibold text-zinc-200">{$t('job.result')}</h3>
				<div class="grid gap-2 sm:grid-cols-3">
					{#each outcomes as outcome (outcome.value)}
						{@const selected = status === outcome.value}
						<button
							type="button"
							aria-pressed={selected}
							class={cn(
								'rounded-xl border p-3 text-left transition-colors',
								selected && outcome.value === 'success' &&
									'border-emerald-500/40 bg-emerald-500/10',
								selected && outcome.value === 'failed' && 'border-rose-500/40 bg-rose-500/10',
								selected && outcome.value === 'cancelled' && 'border-white/25 bg-white/10',
								!selected && 'border-white/10 bg-zinc-950/40 hover:border-white/20 hover:bg-white/5'
							)}
							onclick={() => (status = outcome.value)}
						>
							<span
								class={cn(
									'inline-flex items-center gap-2 text-xs font-medium',
									selected && outcome.value === 'success' && 'text-emerald-300',
									selected && outcome.value === 'failed' && 'text-rose-300',
									selected && outcome.value === 'cancelled' && 'text-zinc-200',
									!selected && 'text-zinc-400'
								)}
							>
								<outcome.icon size={14} />
								{$t(outcome.labelKey)}
							</span>
							<span class="mt-1 block text-[11px] leading-snug text-zinc-600">
								{$t(outcome.hintKey)}
							</span>
						</button>
					{/each}
				</div>
			</section>

			<section class="grid gap-5 sm:grid-cols-2">
				<Field
					label="{$t('job.duration')} ({$t('units.minutesShort')})"
					hint={$t('job.durationHint')}
					optional
				>
					<input
						class="input-base"
						bind:value={durationInput}
						inputmode="decimal"
						placeholder={String(Math.round(plate.estimatedTimeSeconds / 60))}
					/>
				</Field>

				{#if status === 'failed'}
					<Field label={$t('job.failureReason')} optional>
						<input
							class="input-base"
							bind:value={failureReason}
							placeholder={$t('job.failureReasonPlaceholder')}
						/>
					</Field>
				{/if}
			</section>

			{#if status !== 'cancelled' && affectedParts.length > 0}
				<section class="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
					<p class="text-[10px] font-semibold tracking-widest text-zinc-600 uppercase">
						{$t('job.partsCounted')}
					</p>
					<ul class="mt-2 flex flex-wrap gap-1.5">
						{#each affectedParts as entry (entry.part.id)}
							<li
								class={cn(
									'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]',
									status === 'success'
										? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
										: 'border-rose-500/20 bg-rose-500/10 text-rose-300'
								)}
							>
								<span class="truncate">{entry.part.name}</span>
								<span class="tabular-nums">+{entry.quantity}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<p class="text-[11px] text-zinc-600">
				{$t('plates.estimatedTime')}: {formatDuration(plate.estimatedTimeSeconds, durationLabels)}
			</p>
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		<Button variant="primary" onclick={submit} disabled={busy}>
			{busy ? $t('common.saving') : $t('job.submit')}
		</Button>
	{/snippet}
</Modal>
