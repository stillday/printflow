<script lang="ts">
	import { t } from 'svelte-i18n';
	import { Archive, MapPin, Minus, Pencil, RotateCcw, Trash2 } from '@lucide/svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import ProgressRing from '$lib/components/ui/ProgressRing.svelte';
	import StatusPill from '$lib/components/ui/StatusPill.svelte';
	import type { SpoolWithCatalog } from '$lib/types/schema';
	import { formatGrams, formatPercent } from '$lib/utils/format';
	import { fillRatio, spoolTone } from '$lib/utils/status';
	import { rgbaFromHex } from '$lib/utils/color';

	interface Props {
		spool: SpoolWithCatalog;
		onEdit: (spool: SpoolWithCatalog) => void;
		onDeduct: (spool: SpoolWithCatalog) => void;
		onArchive: (spool: SpoolWithCatalog) => void;
		onReactivate: (spool: SpoolWithCatalog) => void;
		onDelete: (spool: SpoolWithCatalog) => void;
	}

	let { spool, onEdit, onDeduct, onArchive, onReactivate, onDelete }: Props = $props();

	const ratio = $derived(fillRatio(spool));
	const tone = $derived(spoolTone(spool.status, ratio));
	const color = $derived(spool.catalog.colorHex);

	const statusKey = $derived(
		spool.status === 'active' && tone === 'amber' ? 'status.low' : `status.${spool.status}`
	);
</script>

<li
	class="card group relative overflow-hidden p-5 transition-colors duration-200 hover:border-indigo-500/40"
	class:opacity-60={spool.status === 'archived'}
>
	<div
		class="pointer-events-none absolute -top-20 -right-20 h-48 w-48 rounded-full blur-3xl"
		style="background: radial-gradient(circle, {rgbaFromHex(color, 0.3)} 0%, transparent 70%);
		       opacity: {spool.status === 'active' ? 0.6 : 0.25}"
		aria-hidden="true"
	></div>

	<div class="relative flex items-start gap-4">
		<ProgressRing
			value={ratio}
			{color}
			size={84}
			label={formatPercent(ratio)}
			sublabel={$t('spools.remaining')}
		/>

		<div class="min-w-0 flex-1">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="truncate text-sm font-semibold text-zinc-100">{spool.catalog.name}</p>
					<p class="truncate text-xs text-zinc-500">{spool.catalog.brand}</p>
				</div>
				<StatusPill labelKey={statusKey} {tone} />
			</div>

			<p class="mt-3 text-lg font-semibold text-zinc-50 tabular-nums">
				{formatGrams(spool.currentWeightNet)}
			</p>
			<p class="text-[11px] text-zinc-600">
				{$t('spools.remainingOf', {
					values: {
						current: Math.round(spool.currentWeightNet),
						nominal: Math.round(spool.catalog.nominalWeight)
					}
				})}
			</p>

			<div class="mt-3 flex flex-wrap items-center gap-2">
				<span
					class="inline-flex rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-zinc-300"
				>
					{spool.catalog.material}
				</span>
				<span class="inline-flex items-center gap-1 text-[11px] text-zinc-500">
					<MapPin size={11} />
					{spool.location || $t('spools.noLocation')}
				</span>
			</div>
		</div>
	</div>

	<div
		class="relative mt-4 flex items-center justify-end gap-1 border-t border-white/5 pt-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
	>
		{#if spool.status !== 'archived'}
			<IconButton label={$t('spools.deduct')} onclick={() => onDeduct(spool)}>
				<Minus size={15} />
			</IconButton>
		{/if}
		<IconButton label={$t('common.edit')} onclick={() => onEdit(spool)}>
			<Pencil size={15} />
		</IconButton>
		{#if spool.status === 'archived'}
			<IconButton label={$t('spools.reactivate')} tone="success" onclick={() => onReactivate(spool)}>
				<RotateCcw size={15} />
			</IconButton>
		{:else}
			<IconButton label={$t('spools.archive')} onclick={() => onArchive(spool)}>
				<Archive size={15} />
			</IconButton>
		{/if}
		<IconButton label={$t('common.delete')} tone="danger" onclick={() => onDelete(spool)}>
			<Trash2 size={15} />
		</IconButton>
	</div>
</li>
