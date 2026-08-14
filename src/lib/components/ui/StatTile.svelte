<script lang="ts">
	import type { Component } from 'svelte';
	import { ChevronRight } from '@lucide/svelte';
	import { cn } from '$lib/utils/cn';
	import { toneTile, type Tone } from './tones';

	interface Props {
		icon: Component<{ size?: number | string; class?: string }>;
		label: string;
		value: string;
		unit?: string;
		tone?: Tone;
		/** Turns the tile into a link to the screen the number came from —
		 *  "37 offene Teile" is a question, and the answer is one click away. */
		href?: string;
		class?: string;
	}

	let {
		icon: Icon,
		label,
		value,
		unit,
		tone = 'indigo',
		href,
		class: className
	}: Props = $props();

	const classes = $derived(
		cn(
			'card group block px-5 py-4 transition-colors duration-200 hover:border-indigo-500/40 hover:bg-white/[0.04]',
			// Only a linked tile reacts to the pointer beyond the border tint, so a
			// dead tile never pretends to be clickable.
			href && 'cursor-pointer hover:bg-white/[0.03]',
			className
		)
	);
</script>

{#snippet body()}
	<div class="flex items-center gap-3">
		<div
			class={cn(
				'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
				toneTile[tone]
			)}
		>
			<Icon size={17} />
		</div>
		<span class="min-w-0 flex-1 text-xs font-medium tracking-wide text-zinc-400 uppercase">
			{label}
		</span>
		{#if href}
			<ChevronRight
				size={16}
				class="shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
			/>
		{/if}
	</div>
	<div class="mt-3 flex items-baseline gap-1.5">
		<span class="text-2xl font-semibold text-zinc-50 tabular-nums">{value}</span>
		{#if unit}
			<span class="text-sm text-zinc-400">{unit}</span>
		{/if}
	</div>
{/snippet}

{#if href}
	<a {href} class={classes}>
		{@render body()}
	</a>
{:else}
	<div class={classes}>
		{@render body()}
	</div>
{/if}
