<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { DEFAULT_FILAMENT_COLOR, normalizeHex, rgbaFromHex } from '$lib/utils/color';

	interface Props {
		color: string | null | undefined;
		size?: number;
		/** Screen-reader name; the swatch itself is decorative. */
		label?: string;
		class?: string;
	}

	let { color, size = 14, label, class: className }: Props = $props();

	const hex = $derived(normalizeHex(color) ?? DEFAULT_FILAMENT_COLOR);
</script>

<span
	class={cn('inline-block shrink-0 rounded-full border border-white/20', className)}
	style="width: {size}px; height: {size}px; background-color: {hex};
	       box-shadow: 0 0 {size * 0.7}px {rgbaFromHex(hex, 0.5)}"
	role={label ? 'img' : 'presentation'}
	aria-label={label}
></span>
