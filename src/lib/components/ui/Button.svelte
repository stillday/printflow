<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
	type Size = 'sm' | 'md' | 'lg';

	interface Props extends Omit<HTMLButtonAttributes & HTMLAnchorAttributes, 'children'> {
		variant?: Variant;
		size?: Size;
		/** Renders an anchor instead of a button — same styling either way. */
		href?: string;
		children: Snippet;
	}

	let {
		variant = 'secondary',
		size = 'md',
		href,
		class: className,
		type = 'button',
		children,
		...rest
	}: Props = $props();

	const variants: Record<Variant, string> = {
		primary:
			'bg-indigo-600 text-white hover:bg-indigo-500 border border-indigo-500/60 shadow-lg shadow-indigo-950/40',
		secondary: 'bg-white/5 text-zinc-200 hover:bg-white/10 border border-white/10',
		ghost:
			'bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-white/5 border border-transparent',
		danger: 'bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/30',
		success:
			'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/30'
	};

	const sizes: Record<Size, string> = {
		sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
		md: 'h-10 px-4 text-sm gap-2 rounded-xl',
		lg: 'h-12 px-5 text-sm gap-2 rounded-xl'
	};

	const classes = $derived(
		cn(
			'inline-flex items-center justify-center font-medium transition-all duration-150 select-none',
			'disabled:pointer-events-none disabled:opacity-40',
			variants[variant],
			sizes[size],
			className
		)
	);
</script>

{#if href}
	<a {href} class={classes} {...rest}>
		{@render children()}
	</a>
{:else}
	<button {type} class={classes} {...rest}>
		{@render children()}
	</button>
{/if}
