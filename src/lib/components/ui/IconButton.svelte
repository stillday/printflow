<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';

	interface Props extends HTMLButtonAttributes {
		/** Required: icon-only controls need an accessible name. */
		label: string;
		tone?: 'neutral' | 'danger' | 'success';
		children: Snippet;
	}

	let { label, tone = 'neutral', class: className, children, ...rest }: Props = $props();

	const tones = {
		neutral: 'text-zinc-400 hover:text-zinc-100 hover:bg-white/10',
		danger: 'text-zinc-400 hover:text-rose-300 hover:bg-rose-500/10',
		success: 'text-zinc-400 hover:text-emerald-300 hover:bg-emerald-500/10'
	} as const;
</script>

<button
	type="button"
	title={label}
	aria-label={label}
	class={cn(
		'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent transition-colors',
		'disabled:pointer-events-none disabled:opacity-40',
		tones[tone],
		className
	)}
	{...rest}
>
	{@render children()}
</button>
