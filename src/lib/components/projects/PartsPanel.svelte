<script lang="ts">
	import { t } from 'svelte-i18n';
	import { Check, Minus, Package, Plus, Trash2 } from '@lucide/svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ProgressBar from '$lib/components/ui/ProgressBar.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { adjustPartCounter, createPart, deletePart, updatePart } from '$lib/db/parts';
	import { touchProject } from '$lib/db/projects';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { Part } from '$lib/types/schema';
	import { formatPercent } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';

	interface Props {
		projectId: number;
		parts: Part[];
		onChanged: () => void;
	}

	let { projectId, parts, onChanged }: Props = $props();

	let newName = $state('');
	let newQuantity = $state('1');
	let adding = $state(false);
	let pendingDelete = $state<Part | null>(null);
	/** Ids currently being written, to keep +/- clicks from racing each other. */
	let busyIds = $state<number[]>([]);

	const totals = $derived(
		parts.reduce(
			(acc, part) => ({
				required: acc.required + part.requiredQuantity,
				printed: acc.printed + part.printedQuantity,
				failed: acc.failed + part.failedQuantity
			}),
			{ required: 0, printed: 0, failed: 0 }
		)
	);

	const ratio = $derived(totals.required > 0 ? Math.min(1, totals.printed / totals.required) : 0);
	const failureRate = $derived(
		totals.printed + totals.failed > 0 ? totals.failed / (totals.printed + totals.failed) : 0
	);

	async function add() {
		const name = newName.trim();
		const quantity = Number.parseInt(newQuantity, 10);
		if (!name || adding) return;

		adding = true;
		try {
			await createPart({
				projectId,
				name,
				requiredQuantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
				printedQuantity: 0,
				failedQuantity: 0
			});
			await touchProject(projectId);
			newName = '';
			newQuantity = '1';
			toasts.success('toast.created');
			onChanged();
		} catch {
			toasts.error('errors.saveFailed');
		} finally {
			adding = false;
		}
	}

	async function adjust(part: Part, counter: 'printed' | 'failed', delta: number) {
		if (part.id === undefined || busyIds.includes(part.id)) return;
		busyIds = [...busyIds, part.id];
		try {
			await adjustPartCounter(part.id, counter, delta);
			await touchProject(projectId);
			onChanged();
		} catch {
			toasts.error('errors.saveFailed');
		} finally {
			busyIds = busyIds.filter((id) => id !== part.id);
		}
	}

	async function renamePart(part: Part, name: string) {
		const trimmed = name.trim();
		if (!trimmed || trimmed === part.name) return;
		try {
			await updatePart({ ...part, name: trimmed });
			onChanged();
		} catch {
			toasts.error('errors.saveFailed');
		}
	}

	async function setRequired(part: Part, value: string) {
		const quantity = Number.parseInt(value, 10);
		if (!Number.isFinite(quantity) || quantity < 0 || quantity === part.requiredQuantity) return;
		try {
			await updatePart({ ...part, requiredQuantity: quantity });
			onChanged();
		} catch {
			toasts.error('errors.saveFailed');
		}
	}

	async function confirmDelete() {
		if (pendingDelete?.id === undefined) return;
		try {
			await deletePart(pendingDelete.id);
			toasts.success('toast.deleted');
			onChanged();
		} catch {
			toasts.error('errors.deleteFailed');
		} finally {
			pendingDelete = null;
		}
	}
</script>

<div class="grid gap-5">
	{#if parts.length > 0}
		<div class="card p-5">
			<div class="flex flex-wrap items-baseline justify-between gap-3">
				<span class="text-xs font-medium tracking-wide text-zinc-500 uppercase">
					{$t('parts.totalProgress')}
				</span>
				<span class="text-sm font-semibold text-zinc-100 tabular-nums">
					{totals.printed} <span class="text-zinc-600">/ {totals.required}</span>
					<span class="ml-2 text-zinc-500">{formatPercent(ratio)}</span>
				</span>
			</div>
			<ProgressBar
				class="mt-3"
				value={ratio}
				secondary={totals.required > 0 ? totals.failed / totals.required : 0}
				tone={ratio >= 1 ? 'emerald' : 'indigo'}
			/>
			{#if totals.failed > 0}
				<p class="mt-2.5 text-[11px] text-zinc-600">
					{$t('parts.failed')}: <span class="text-rose-400 tabular-nums">{totals.failed}</span>
					<span class="ml-2">{$t('parts.failedRate')}: {formatPercent(failureRate)}</span>
				</p>
			{/if}
		</div>
	{/if}

	<div class="card overflow-hidden">
		{#if parts.length === 0}
			<EmptyState icon={Package} title={$t('parts.empty')} body={$t('parts.emptyBody')} />
		{:else}
			<ul class="divide-y divide-white/5">
				{#each parts as part (part.id)}
					{@const done = part.printedQuantity >= part.requiredQuantity}
					{@const open = Math.max(0, part.requiredQuantity - part.printedQuantity)}
					<li class="group flex flex-wrap items-center gap-4 px-5 py-3.5">
						<div
							class={cn(
								'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[11px] font-semibold',
								done
									? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
									: 'border-white/10 bg-white/5 text-zinc-500'
							)}
							aria-hidden="true"
						>
							{#if done}
								<Check size={14} />
							{:else}
								{open}
							{/if}
						</div>

						<input
							class="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-zinc-100 transition-colors hover:border-white/10 focus:border-indigo-500/60 focus:bg-zinc-950 focus:outline-none"
							value={part.name}
							aria-label={$t('parts.edit')}
							onblur={(event) => renamePart(part, event.currentTarget.value)}
							onkeydown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
						/>

						<div class="flex shrink-0 items-center gap-1.5">
							<span class="text-[10px] tracking-widest text-zinc-600 uppercase">
								{$t('parts.printed')}
							</span>
							<IconButton
								label={$t('parts.decrement')}
								class="h-7 w-7"
								disabled={part.printedQuantity === 0 || busyIds.includes(part.id!)}
								onclick={() => adjust(part, 'printed', -1)}
							>
								<Minus size={13} />
							</IconButton>
							<span
								class="w-14 text-center text-sm font-semibold text-zinc-100 tabular-nums"
								aria-live="polite"
							>
								{part.printedQuantity}<span class="text-zinc-600">/{part.requiredQuantity}</span>
							</span>
							<IconButton
								label={$t('parts.increment')}
								class="h-7 w-7"
								tone="success"
								disabled={busyIds.includes(part.id!)}
								onclick={() => adjust(part, 'printed', 1)}
							>
								<Plus size={13} />
							</IconButton>
						</div>

						<div class="flex shrink-0 items-center gap-1.5">
							<span class="text-[10px] tracking-widest text-zinc-600 uppercase">
								{$t('parts.required')}
							</span>
							<input
								class="input-base h-7 w-16 py-0 text-center text-xs tabular-nums"
								type="number"
								min="0"
								step="1"
								aria-label={$t('parts.required')}
								value={part.requiredQuantity}
								onblur={(event) => setRequired(part, event.currentTarget.value)}
							/>
						</div>

						<div class="flex shrink-0 items-center gap-1.5">
							<span class="text-[10px] tracking-widest text-zinc-600 uppercase">
								{$t('parts.failed')}
							</span>
							<IconButton
								label={$t('parts.failed')}
								class="h-7 w-7"
								tone="danger"
								disabled={busyIds.includes(part.id!)}
								onclick={() => adjust(part, 'failed', 1)}
							>
								<Plus size={13} />
							</IconButton>
							<span class="w-6 text-center text-sm tabular-nums {part.failedQuantity > 0 ? 'text-rose-400' : 'text-zinc-600'}">
								{part.failedQuantity}
							</span>
						</div>

						<IconButton
							label={$t('common.delete')}
							tone="danger"
							class="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
							onclick={() => (pendingDelete = part)}
						>
							<Trash2 size={15} />
						</IconButton>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			class="flex flex-wrap items-center gap-3 border-t border-white/5 bg-zinc-950/40 px-5 py-4"
			onsubmit={(event) => {
				event.preventDefault();
				add();
			}}
		>
			<input
				class="input-base min-w-0 flex-1"
				bind:value={newName}
				placeholder={$t('parts.namePlaceholder')}
				aria-label={$t('parts.add')}
			/>
			<input
				class="input-base w-20 text-center tabular-nums"
				type="number"
				min="1"
				step="1"
				bind:value={newQuantity}
				aria-label={$t('parts.required')}
			/>
			<Button variant="primary" type="submit" disabled={!newName.trim() || adding}>
				<Plus size={16} />
				{$t('parts.add')}
			</Button>
		</form>
	</div>
</div>

<ConfirmDialog
	open={pendingDelete !== null}
	title={$t('parts.deleteConfirm', { values: { name: pendingDelete?.name ?? '' } })}
	body={$t('parts.deleteBody')}
	onConfirm={confirmDelete}
	onCancel={() => (pendingDelete = null)}
/>
