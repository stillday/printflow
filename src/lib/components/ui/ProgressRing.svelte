<script lang="ts">
	import { clampRatio } from '$lib/utils/format';
	import { rgbaFromHex } from '$lib/utils/color';

	interface Props {
		/** 0 – 1. Values outside the range are clamped. */
		value: number;
		/** Filament colour; the ring and its glow are drawn in it. */
		color: string;
		size?: number;
		stroke?: number;
		/** Rendered in the middle of the ring. */
		label?: string;
		sublabel?: string;
	}

	let { value, color, size = 96, stroke = 7, label, sublabel }: Props = $props();

	const ratio = $derived(clampRatio(value));
	const radius = $derived((size - stroke) / 2);
	const circumference = $derived(2 * Math.PI * radius);
	const offset = $derived(circumference * (1 - ratio));
</script>

<div class="relative shrink-0" style="width: {size}px; height: {size}px">
	<div
		class="absolute inset-0 rounded-full blur-lg transition-opacity"
		style="background: radial-gradient(circle, {rgbaFromHex(color, 0.35)} 0%, transparent 70%);
		       opacity: {0.25 + ratio * 0.55}"
		aria-hidden="true"
	></div>

	<svg width={size} height={size} viewBox="0 0 {size} {size}" class="relative -rotate-90">
		<circle
			cx={size / 2}
			cy={size / 2}
			r={radius}
			fill="none"
			stroke="rgba(255,255,255,0.07)"
			stroke-width={stroke}
		/>
		<circle
			cx={size / 2}
			cy={size / 2}
			r={radius}
			fill="none"
			stroke={color}
			stroke-width={stroke}
			stroke-linecap="round"
			stroke-dasharray={circumference}
			stroke-dashoffset={offset}
			style="transition: stroke-dashoffset 0.4s cubic-bezier(0.16, 1, 0.3, 1)"
		/>
	</svg>

	{#if label}
		<div class="absolute inset-0 flex flex-col items-center justify-center">
			<span class="text-sm font-semibold text-zinc-100 tabular-nums">{label}</span>
			{#if sublabel}
				<span class="text-2xs tracking-wide text-zinc-400 uppercase">{sublabel}</span>
			{/if}
		</div>
	{/if}
</div>
