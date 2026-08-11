<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		icon: Component<{ size?: number | string; class?: string }>;
		title: string;
		body?: string;
		action?: Snippet;
	}

	let { icon: Icon, title, body, action }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center px-6 py-16 text-center">
	<div
		class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-400"
	>
		<Icon size={24} />
	</div>
	<h3 class="text-sm font-semibold text-zinc-200">{title}</h3>
	{#if body}
		<p class="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-400">{body}</p>
	{/if}
	{#if action}
		<div class="mt-5">{@render action()}</div>
	{/if}
</div>
