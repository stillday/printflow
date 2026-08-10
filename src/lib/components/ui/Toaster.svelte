<script lang="ts">
	import { t } from 'svelte-i18n';
	import { CircleAlert, CircleCheck, Info, X } from '@lucide/svelte';
	import { toasts } from '$lib/stores/toast.svelte';

	const tones = {
		success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
		error: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
		info: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300'
	} as const;

	const icons = { success: CircleCheck, error: CircleAlert, info: Info } as const;
</script>

<div
	class="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-full max-w-sm flex-col gap-2"
	aria-live="polite"
	role="status"
>
	{#each toasts.items as toast (toast.id)}
		{@const Icon = icons[toast.variant]}
		<div
			class="animate-pop-in pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl shadow-black/40 backdrop-blur-md {tones[
				toast.variant
			]}"
		>
			<Icon size={16} class="shrink-0" />
			<span class="min-w-0 flex-1 text-zinc-100">{$t(toast.key, { values: toast.values })}</span>
			<button
				type="button"
				class="shrink-0 text-current opacity-60 transition-opacity hover:opacity-100"
				aria-label={$t('common.close')}
				onclick={() => toasts.dismiss(toast.id)}
			>
				<X size={14} />
			</button>
		</div>
	{/each}
</div>
