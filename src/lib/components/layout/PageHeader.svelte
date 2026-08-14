<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle?: string;
		/** Trailing controls, typically the primary "add" button. */
		actions?: Snippet;
		/** Optional breadcrumb / back link rendered above the title. */
		eyebrow?: Snippet;
	}

	let { title, subtitle, actions, eyebrow }: Props = $props();
</script>

<div class="flex flex-wrap items-end justify-between gap-4 page-x pt-8 pb-6">
	<div class="min-w-0">
		{#if eyebrow}
			<div class="mb-2">{@render eyebrow()}</div>
		{/if}
		<h1 class="truncate text-xl font-semibold tracking-tight text-zinc-50">{title}</h1>
		{#if subtitle}
			<p class="mt-1 text-sm text-zinc-400">{subtitle}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>
	{/if}
</div>
