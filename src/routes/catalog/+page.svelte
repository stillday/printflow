<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { t } from 'svelte-i18n';
	import { Layers, Pencil, Plus, Thermometer, Trash2 } from '@lucide/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import CatalogModal from '$lib/components/catalog/CatalogModal.svelte';
	import { deleteCatalog, listCatalog, type CatalogWithUsage } from '$lib/db/catalog';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { FilamentCatalog } from '$lib/types/schema';
	import { formatGrams, formatNumber } from '$lib/utils/format';
	import { rgbaFromHex } from '$lib/utils/color';

	let entries = $state<CatalogWithUsage[]>([]);
	let loading = $state(true);
	let search = $state('');

	let modalOpen = $state(false);
	let editing = $state<FilamentCatalog | null>(null);
	let pendingDelete = $state<CatalogWithUsage | null>(null);

	async function load() {
		try {
			entries = await listCatalog();
		} catch {
			toasts.error('errors.loadFailed');
		} finally {
			loading = false;
		}
	}

	// Deep link from the header's quick search: /catalog?entry=12. Handled once,
	// so a later reload of `entries` does not reopen the dialog.
	let deepLinkHandled = $state(false);
	$effect(() => {
		if (deepLinkHandled || entries.length === 0) return;
		const id = Number(page.url.searchParams.get('entry'));
		if (!id) return;
		deepLinkHandled = true;
		const found = entries.find((item) => item.id === id);
		if (found) openEdit(found);
	});

	onMount(load);

	const filtered = $derived.by(() => {
		const term = search.trim().toLowerCase();
		if (!term) return entries;
		return entries.filter((entry) =>
			`${entry.brand} ${entry.name} ${entry.material}`.toLowerCase().includes(term)
		);
	});

	function openCreate() {
		editing = null;
		modalOpen = true;
	}

	function openEdit(entry: FilamentCatalog) {
		editing = entry;
		modalOpen = true;
	}

	async function confirmDelete() {
		if (!pendingDelete?.id) return;
		try {
			await deleteCatalog(pendingDelete.id);
			toasts.success('toast.deleted');
			await load();
		} catch {
			toasts.error('errors.deleteFailed');
		} finally {
			pendingDelete = null;
		}
	}

	function spoolCountKey(count: number): string {
		if (count === 0) return 'catalog.spoolCount_0';
		if (count === 1) return 'catalog.spoolCount_1';
		return 'catalog.spoolCount';
	}
</script>

<PageHeader title={$t('catalog.title')} subtitle={$t('catalog.subtitle')}>
	{#snippet actions()}
		<Button variant="primary" onclick={openCreate}>
			<Plus size={16} />
			{$t('catalog.add')}
		</Button>
	{/snippet}
</PageHeader>

<div class="px-8 pb-10">
	{#if loading}
		<p class="py-16 text-center text-sm text-zinc-400">{$t('common.loading')}</p>
	{:else if entries.length === 0}
		<div class="card">
			<EmptyState icon={Layers} title={$t('catalog.empty')} body={$t('catalog.emptyBody')}>
				{#snippet action()}
					<Button variant="primary" onclick={openCreate}>
						<Plus size={16} />
						{$t('catalog.add')}
					</Button>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<div class="mb-5 max-w-xs">
			<input
				class="input-base"
				type="search"
				bind:value={search}
				placeholder={$t('common.searchPlaceholder')}
				aria-label={$t('common.search')}
			/>
		</div>

		{#if filtered.length === 0}
			<div class="card">
				<EmptyState icon={Layers} title={$t('common.noResults')} body={$t('common.noResultsHint')} />
			</div>
		{:else}
			<ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{#each filtered as entry (entry.id)}
					<li
						class="card group relative overflow-hidden p-5 transition-colors duration-200 hover:border-indigo-500/40"
					>
						<div
							class="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full blur-3xl transition-opacity duration-300 group-hover:opacity-100"
							style="background: radial-gradient(circle, {rgbaFromHex(entry.colorHex, 0.32)} 0%, transparent 70%);
							       opacity: 0.55"
							aria-hidden="true"
						></div>

						<div class="relative flex items-start gap-4">
							<div
								class="h-12 w-12 shrink-0 rounded-xl border border-white/20"
								style="background-color: {entry.colorHex};
								       box-shadow: 0 0 22px {rgbaFromHex(entry.colorHex, 0.55)}"
								aria-hidden="true"
							></div>

							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold text-zinc-100">{entry.name}</p>
								<p class="truncate text-xs text-zinc-400">{entry.brand}</p>
								<span
									class="mt-2 inline-flex rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-zinc-300"
								>
									{entry.material}
								</span>
							</div>

							<div
							class="flex shrink-0 gap-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
						>
								<IconButton label={$t('common.edit')} onclick={() => openEdit(entry)}>
									<Pencil size={15} />
								</IconButton>
								<IconButton
									label={$t('common.delete')}
									tone="danger"
									onclick={() => (pendingDelete = entry)}
								>
									<Trash2 size={15} />
								</IconButton>
							</div>
						</div>

						<dl class="relative mt-5 grid grid-cols-3 gap-3 border-t border-white/5 pt-4 text-xs">
							<div>
								<dt class="text-zinc-400">{$t('catalog.fields.density')}</dt>
								<dd class="mt-0.5 text-zinc-300 tabular-nums">
									{formatNumber(entry.density, 2)}
									{$t('units.gramPerCubicCm')}
								</dd>
							</div>
							<div>
								<dt class="text-zinc-400">{$t('catalog.fields.spoolTareWeight')}</dt>
								<dd class="mt-0.5 text-zinc-300 tabular-nums">
									{formatGrams(entry.spoolTareWeight)}
								</dd>
							</div>
							<div>
								<dt class="text-zinc-400">{$t('catalog.fields.nominalWeight')}</dt>
								<dd class="mt-0.5 text-zinc-300 tabular-nums">
									{formatGrams(entry.nominalWeight)}
								</dd>
							</div>
						</dl>

						<div class="relative mt-4 flex items-center justify-between gap-3 text-xs">
							<span class="text-zinc-400">
								{$t(spoolCountKey(entry.spoolCount), { values: { count: entry.spoolCount } })}
								{#if entry.totalRemaining > 0}
									<span class="text-zinc-400"> · {formatGrams(entry.totalRemaining)}</span>
								{/if}
							</span>
							{#if entry.printingTempMin || entry.printingTempMax}
								<span class="inline-flex items-center gap-1.5 text-zinc-400 tabular-nums">
									<Thermometer size={13} />
									{entry.printingTempMin ?? '–'}–{entry.printingTempMax ?? '–'}
									{$t('units.celsius')}
								</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<CatalogModal
	open={modalOpen}
	entry={editing}
	onClose={() => (modalOpen = false)}
	onSaved={load}
/>

<!--
	The body states the blast radius instead of only warning that one exists: this
	delete cascades, and the numbers are the difference between dropping an unused
	entry and dropping four spools with 3.2 kg of filament on the shelf.
-->
<ConfirmDialog
	open={pendingDelete !== null}
	title={$t('catalog.deleteConfirm', { values: { name: pendingDelete?.name ?? '' } })}
	body={pendingDelete && pendingDelete.spoolCount > 0
		? $t('catalog.deleteBodyCascade', {
				values: {
					count: pendingDelete.spoolCount,
					remaining: formatGrams(pendingDelete.totalRemaining)
				}
			})
		: $t('catalog.deleteBodyNoSpools')}
	onConfirm={confirmDelete}
	onCancel={() => (pendingDelete = null)}
/>
