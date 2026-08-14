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

	/**
	 * Two live regions, because the two kinds of message have different urgency:
	 * an error interrupts (`assertive`), a confirmation waits its turn
	 * (`polite`). One shared `role="status"` would have announced failures as
	 * casually as a "Saved".
	 */
	const errors = $derived(toasts.items.filter((toast) => toast.variant === 'error'));
	const notices = $derived(toasts.items.filter((toast) => toast.variant !== 'error'));
</script>

{#snippet toastList(items: typeof toasts.items)}
	{#each items as toast (toast.id)}
		{@const Icon = icons[toast.variant]}
		<div
			class="animate-pop-in pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl shadow-black/40 backdrop-blur-md {tones[
				toast.variant
			]}"
		>
			<Icon size={16} class="mt-0.5 shrink-0" />
			<span class="min-w-0 flex-1 leading-snug text-zinc-100">
				{$t(toast.key, { values: toast.values })}
			</span>
			<button
				type="button"
				class="-m-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md p-1 text-current opacity-70 transition-opacity hover:opacity-100"
				aria-label={$t('common.close')}
				onclick={() => toasts.dismiss(toast.id)}
			>
				<X size={14} />
			</button>
		</div>
	{/each}
{/snippet}

<div
	class="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-full max-w-sm flex-col gap-2"
>
	<!-- Errors sit above the notices and stay until dismissed. -->
	<div class="flex flex-col gap-2" role="alert" aria-live="assertive">
		{@render toastList(errors)}
	</div>
	<div class="flex flex-col gap-2" role="status" aria-live="polite">
		{@render toastList(notices)}
	</div>
</div>
