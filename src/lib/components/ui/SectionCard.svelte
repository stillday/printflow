<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';
	import { toneTile, type Tone } from './tones';

	interface Props {
		icon: Component<{ size?: number | string; class?: string }>;
		title: string;
		/** One-line explanation under the title. */
		hint?: string;
		tone?: Tone;
		/** Header-right slot for a button or pill. */
		actions?: Snippet;
		children?: Snippet;
		class?: string;
	}

	let {
		icon: Icon,
		title,
		hint,
		tone = 'indigo',
		actions,
		children,
		class: className
	}: Props = $props();
</script>

<!--
	The `card p-6` + tinted icon tile + <h2> + hint header was hand-rolled six
	times across the settings page and the dashboard. Keeping it here means the
	heading level, the tile size and the spacing below the header stay identical
	everywhere instead of drifting per screen.
-->
<section class={cn('card p-6', className)}>
	<div class="flex items-center gap-3">
		<div
			class={cn(
				'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
				toneTile[tone]
			)}
		>
			<Icon size={17} />
		</div>
		<div class="min-w-0 flex-1">
			<h2 class="text-sm font-semibold text-zinc-100">{title}</h2>
			{#if hint}
				<p class="mt-0.5 text-xs text-zinc-400">{hint}</p>
			{/if}
		</div>
		{#if actions}
			<div class="shrink-0">{@render actions()}</div>
		{/if}
	</div>

	{#if children}
		<div class="mt-5">{@render children()}</div>
	{/if}
</section>
