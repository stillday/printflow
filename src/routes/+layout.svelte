<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { isLoading, t } from 'svelte-i18n';
	import { CircleAlert, Layers } from '@lucide/svelte';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import Header from '$lib/components/layout/Header.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { bootstrap } from '$lib/bootstrap';

	let { children }: { children: Snippet } = $props();

	let startup = $state(bootstrap());

	function retry() {
		startup = bootstrap();
	}
</script>

{#await startup}
	<div class="flex h-screen flex-col items-center justify-center gap-4 bg-zinc-950">
		<div
			class="flex h-12 w-12 animate-pulse items-center justify-center rounded-2xl border border-indigo-500/30 bg-indigo-500/10"
		>
			<Layers size={22} class="text-indigo-300" />
		</div>
		<p class="text-sm text-zinc-500">PrintFlow</p>
	</div>
{:then}
	{#if $isLoading}
		<div class="flex h-screen items-center justify-center bg-zinc-950">
			<p class="text-sm text-zinc-500">PrintFlow</p>
		</div>
	{:else}
		<div class="flex h-screen overflow-hidden bg-zinc-950">
			<Sidebar />
			<div class="flex min-w-0 flex-1 flex-col">
				<Header />
				<main class="min-h-0 flex-1 overflow-y-auto">
					{@render children()}
				</main>
			</div>
		</div>
		<Toaster />
	{/if}
{:catch error}
	<div class="flex h-screen items-center justify-center bg-zinc-950 p-8">
		<div class="card max-w-md p-6">
			<div class="flex items-start gap-4">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400"
				>
					<CircleAlert size={18} />
				</div>
				<div class="min-w-0">
					<h1 class="text-sm font-semibold text-zinc-100">
						{$isLoading ? 'PrintFlow' : $t('errors.dbInit')}
					</h1>
					<p class="mt-2 text-xs break-words text-zinc-500" data-selectable>
						{error instanceof Error ? error.message : String(error)}
					</p>
					<div class="mt-4">
						<Button variant="primary" size="sm" onclick={retry}>
							{$isLoading ? '↻' : $t('common.retry')}
						</Button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/await}
