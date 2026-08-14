<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { t } from 'svelte-i18n';
	import { Boxes, Layers, Plus } from '@lucide/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import SpoolCard from '$lib/components/spools/SpoolCard.svelte';
	import SpoolModal from '$lib/components/spools/SpoolModal.svelte';
	import DeductModal from '$lib/components/spools/DeductModal.svelte';
	import { deleteSpool, listSpools, setSpoolStatus } from '$lib/db/spools';
	import { listCatalog } from '$lib/db/catalog';
	import { toasts } from '$lib/stores/toast.svelte';
	import { SPOOL_STATUSES, type FilamentCatalog, type SpoolWithCatalog } from '$lib/types/schema';
	import { formatGrams } from '$lib/utils/format';
	import { spoolTitle } from '$lib/utils/status';

	let spools = $state<SpoolWithCatalog[]>([]);
	let catalog = $state<FilamentCatalog[]>([]);
	let loading = $state(true);

	let search = $state('');
	let statusFilter = $state<'all' | (typeof SPOOL_STATUSES)[number]>('active');
	let materialFilter = $state('all');
	let locationFilter = $state('all');

	let modalOpen = $state(false);
	let editing = $state<SpoolWithCatalog | null>(null);
	let deducting = $state<SpoolWithCatalog | null>(null);
	let pendingDelete = $state<SpoolWithCatalog | null>(null);

	async function load() {
		try {
			[spools, catalog] = await Promise.all([listSpools(), listCatalog()]);
		} catch {
			toasts.error('errors.loadFailed');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	// Deep link from quick search: /spools?spool=7 opens that spool for editing.
	let deepLinkHandled = $state(false);
	$effect(() => {
		if (deepLinkHandled || spools.length === 0) return;
		const id = Number(page.url.searchParams.get('spool'));
		if (!id) return;
		deepLinkHandled = true;
		const found = spools.find((item) => item.id === id);
		if (found) openEdit(found);
	});

	const materials = $derived([...new Set(spools.map((s) => s.catalog.material))].sort());
	const locations = $derived(
		[...new Set(spools.map((s) => s.location).filter((value): value is string => !!value))].sort()
	);

	const filtered = $derived.by(() => {
		const term = search.trim().toLowerCase();
		return spools.filter((spool) => {
			if (statusFilter !== 'all' && spool.status !== statusFilter) return false;
			if (materialFilter !== 'all' && spool.catalog.material !== materialFilter) return false;
			if (locationFilter !== 'all' && (spool.location ?? '') !== locationFilter) return false;
			if (!term) return true;
			return `${spool.catalog.brand} ${spool.catalog.name} ${spool.catalog.material} ${spool.location ?? ''} ${spool.qrOrBarCode ?? ''}`
				.toLowerCase()
				.includes(term);
		});
	});

	const totalRemaining = $derived(
		filtered.reduce((sum, spool) => sum + (spool.status === 'active' ? spool.currentWeightNet : 0), 0)
	);

	function openCreate() {
		editing = null;
		modalOpen = true;
	}

	function openEdit(spool: SpoolWithCatalog) {
		editing = spool;
		modalOpen = true;
	}

	async function changeStatus(spool: SpoolWithCatalog, status: 'archived' | 'active') {
		if (!spool.id) return;
		try {
			await setSpoolStatus(spool.id, status);
			toasts.success('toast.updated');
			await load();
		} catch {
			toasts.error('errors.saveFailed');
		}
	}

	async function confirmDelete() {
		if (!pendingDelete?.id) return;
		try {
			await deleteSpool(pendingDelete.id);
			toasts.success('toast.deleted');
			await load();
		} catch {
			toasts.error('errors.deleteFailed');
		} finally {
			pendingDelete = null;
		}
	}
</script>

<PageHeader title={$t('spools.title')} subtitle={$t('spools.subtitle')}>
	{#snippet actions()}
		<Button variant="primary" onclick={openCreate} disabled={catalog.length === 0}>
			<Plus size={16} />
			{$t('spools.add')}
		</Button>
	{/snippet}
</PageHeader>

<div class="page-x pb-10">
	{#if loading}
		<p class="py-16 text-center text-sm text-zinc-400">{$t('common.loading')}</p>
	{:else if catalog.length === 0}
		<div class="card">
			<EmptyState icon={Layers} title={$t('spools.needsCatalog')} body={$t('spools.needsCatalogBody')}>
				{#snippet action()}
					<Button variant="primary" href="/catalog">
						<Plus size={16} />
						{$t('catalog.add')}
					</Button>
				{/snippet}
			</EmptyState>
		</div>
	{:else if spools.length === 0}
		<div class="card">
			<EmptyState icon={Boxes} title={$t('spools.empty')} body={$t('spools.emptyBody')}>
				{#snippet action()}
					<Button variant="primary" onclick={openCreate}>
						<Plus size={16} />
						{$t('spools.add')}
					</Button>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<div class="mb-5 flex flex-wrap items-end gap-3">
			<div class="w-full max-w-xs">
				<input
					class="input-base"
					type="search"
					bind:value={search}
					placeholder={$t('common.searchPlaceholder')}
					aria-label={$t('common.search')}
				/>
			</div>

			<div>
				<span class="label-base">{$t('spools.filterStatus')}</span>
				<select class="input-base w-40" bind:value={statusFilter}>
					<option value="all">{$t('common.all')}</option>
					{#each SPOOL_STATUSES as value (value)}
						<option {value}>{$t(`status.${value}`)}</option>
					{/each}
				</select>
			</div>

			<div>
				<span class="label-base">{$t('spools.filterMaterial')}</span>
				<select class="input-base w-40" bind:value={materialFilter}>
					<option value="all">{$t('common.all')}</option>
					{#each materials as material (material)}
						<option value={material}>{material}</option>
					{/each}
				</select>
			</div>

			{#if locations.length > 0}
				<div>
					<span class="label-base">{$t('spools.filterLocation')}</span>
					<select class="input-base w-40" bind:value={locationFilter}>
						<option value="all">{$t('common.all')}</option>
						{#each locations as location (location)}
							<option value={location}>{location}</option>
						{/each}
					</select>
				</div>
			{/if}

			<p class="ml-auto pb-2 text-xs text-zinc-400">
				{$t('common.total')}:
				<span class="font-semibold text-zinc-300 tabular-nums">{formatGrams(totalRemaining)}</span>
			</p>
		</div>

		{#if filtered.length === 0}
			<div class="card">
				<EmptyState icon={Boxes} title={$t('common.noResults')} body={$t('common.noResultsHint')} />
			</div>
		{:else}
			<ul class="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
				{#each filtered as spool (spool.id)}
					<SpoolCard
						{spool}
						onEdit={openEdit}
						onDeduct={(item) => (deducting = item)}
						onArchive={(item) => changeStatus(item, 'archived')}
						onReactivate={(item) => changeStatus(item, 'active')}
						onDelete={(item) => (pendingDelete = item)}
					/>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<SpoolModal
	open={modalOpen}
	spool={editing}
	{catalog}
	onClose={() => (modalOpen = false)}
	onSaved={load}
/>

<DeductModal spool={deducting} onClose={() => (deducting = null)} onSaved={load} />

<!--
	The dialog names the spool: several spools of the same filament differ only by
	location, and the cards are close together — "Delete spool?" alone gave no way
	to tell whether the right row was hit.
-->
<ConfirmDialog
	open={pendingDelete !== null}
	title={pendingDelete
		? $t('spools.deleteConfirmNamed', { values: { name: spoolTitle(pendingDelete) } })
		: $t('spools.deleteConfirm')}
	body={$t('spools.deleteBody')}
	onConfirm={confirmDelete}
	onCancel={() => (pendingDelete = null)}
/>
