<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';
	import { toneTile, type Tone } from './tones';

	interface Props {
		/** Defaults to the neutral badge used for material/size metadata. */
		tone?: Tone;
		class?: string;
		children: Snippet;
	}

	let { tone = 'zinc', class: className, children }: Props = $props();

	const tones: Record<Tone, string> = {
		...toneTile,
		// A chip carries content (a material, a nozzle size), not a status —
		// one step brighter than the tile map's muted label zinc.
		zinc: 'border-white/10 bg-white/5 text-zinc-300'
	};
</script>

<!--
	Static metadata badge. `StatusPill` stays the component for *states*: it is
	round, dotted and takes an i18n key, because a status is a closed set. A chip
	is free text and square, and was byte-identically re-typed in `SpoolCard` and
	the catalog grid before this existed.
-->
<span
	class={cn(
		'inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium',
		tones[tone],
		className
	)}
>
	{@render children()}
</span>
