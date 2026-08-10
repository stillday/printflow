<script lang="ts">
	import { t } from 'svelte-i18n';
	import { cn } from '$lib/utils/cn';

	type Tone = 'emerald' | 'amber' | 'rose' | 'indigo' | 'zinc';

	interface Props {
		/** i18n key, e.g. `status.active`. */
		labelKey: string;
		tone: Tone;
		class?: string;
	}

	let { labelKey, tone, class: className }: Props = $props();

	const tones: Record<Tone, string> = {
		emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
		amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
		rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
		indigo: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
		zinc: 'bg-white/5 text-zinc-400 border-white/10'
	};
</script>

<span
	class={cn(
		'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap',
		tones[tone],
		className
	)}
>
	<span class="h-1.5 w-1.5 rounded-full bg-current opacity-80"></span>
	{$t(labelKey)}
</span>
