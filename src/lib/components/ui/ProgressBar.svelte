<script lang="ts">
	import { clampRatio } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';

	interface Props {
		/** 0 – 1, clamped. */
		value: number;
		/** Second, muted segment drawn after `value` — used for failed prints. */
		secondary?: number;
		tone?: 'indigo' | 'emerald' | 'amber' | 'rose';
		class?: string;
	}

	let { value, secondary = 0, tone = 'indigo', class: className }: Props = $props();

	const tones = {
		indigo: 'bg-indigo-500',
		emerald: 'bg-emerald-500',
		amber: 'bg-amber-500',
		rose: 'bg-rose-500'
	} as const;

	const primary = $derived(clampRatio(value));
	const extra = $derived(clampRatio(secondary));
</script>

<div
	class={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-white/5', className)}
	role="progressbar"
	aria-valuenow={Math.round(primary * 100)}
	aria-valuemin="0"
	aria-valuemax="100"
>
	<div
		class={cn('h-full transition-[width] duration-500 ease-out', tones[tone])}
		style="width: {primary * 100}%"
	></div>
	{#if extra > 0}
		<div
			class="h-full bg-rose-500/40 transition-[width] duration-500 ease-out"
			style="width: {Math.min(extra, 1 - primary) * 100}%"
		></div>
	{/if}
</div>
