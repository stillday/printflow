<script lang="ts">
	import { t } from 'svelte-i18n';
	import { cn } from '$lib/utils/cn';
	import { toneTile, type Tone } from './tones';

	interface Props {
		/** i18n key, e.g. `status.active`. */
		labelKey: string;
		tone: Tone;
		class?: string;
	}

	let { labelKey, tone, class: className }: Props = $props();
</script>

<span
	class={cn(
		'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap',
		toneTile[tone],
		className
	)}
>
	<span class="h-1.5 w-1.5 rounded-full bg-current opacity-80"></span>
	{$t(labelKey)}
</span>
