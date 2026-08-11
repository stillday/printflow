<script lang="ts">
	import type { Component } from 'svelte';
	import { cn } from '$lib/utils/cn';

	type Tone = 'indigo' | 'emerald' | 'amber' | 'rose';

	interface Props {
		icon: Component<{ size?: number | string; class?: string }>;
		label: string;
		value: string;
		unit?: string;
		tone?: Tone;
		class?: string;
	}

	let { icon: Icon, label, value, unit, tone = 'indigo', class: className }: Props = $props();

	const tones: Record<Tone, string> = {
		indigo: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300',
		emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
		amber: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
		rose: 'border-rose-500/20 bg-rose-500/10 text-rose-400'
	};
</script>

<div
	class={cn(
		'card group px-5 py-4 transition-colors duration-200 hover:border-indigo-500/40',
		className
	)}
>
	<div class="flex items-center gap-3">
		<div
			class={cn(
				'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
				tones[tone]
			)}
		>
			<Icon size={17} />
		</div>
		<span class="text-xs font-medium tracking-wide text-zinc-400 uppercase">{label}</span>
	</div>
	<div class="mt-3 flex items-baseline gap-1.5">
		<span class="text-2xl font-semibold text-zinc-50 tabular-nums">{value}</span>
		{#if unit}
			<span class="text-sm text-zinc-400">{unit}</span>
		{/if}
	</div>
</div>
