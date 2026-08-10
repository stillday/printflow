<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t } from 'svelte-i18n';
	import { X } from '@lucide/svelte';
	import { cn } from '$lib/utils/cn';

	interface Props {
		open: boolean;
		title: string;
		subtitle?: string;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		onClose: () => void;
		children: Snippet;
		footer?: Snippet;
	}

	let { open = $bindable(), title, subtitle, size = 'md', onClose, children, footer }: Props =
		$props();

	const widths = {
		sm: 'max-w-md',
		md: 'max-w-xl',
		lg: 'max-w-3xl',
		xl: 'max-w-5xl'
	} as const;

	let panel = $state<HTMLDivElement | null>(null);

	/**
	 * Keeps Tab inside the dialog and closes on Escape. Implemented by hand
	 * rather than via <dialog> so the backdrop animation and Tauri's custom
	 * chrome behave consistently across platforms.
	 */
	function onKeydown(event: KeyboardEvent) {
		if (!open) return;

		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
			return;
		}

		if (event.key !== 'Tab' || !panel) return;

		const focusable = panel.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
		);
		if (focusable.length === 0) return;

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	// Move focus into the dialog once it opens, and lock background scrolling.
	$effect(() => {
		if (!open || !panel) return;

		const previouslyFocused = document.activeElement as HTMLElement | null;
		const target = panel.querySelector<HTMLElement>(
			'[data-autofocus], input:not([type="hidden"]):not([disabled]), textarea, select, button'
		);
		target?.focus();

		const { overflow } = document.body.style;
		document.body.style.overflow = 'hidden';

		return () => {
			document.body.style.overflow = overflow;
			previouslyFocused?.focus?.();
		};
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
		<button
			type="button"
			class="animate-fade-in fixed inset-0 cursor-default bg-black/70 backdrop-blur-sm"
			aria-label={$t('common.close')}
			onclick={onClose}
			tabindex="-1"
		></button>

		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-label={title}
			class={cn(
				'animate-pop-in relative z-10 my-auto w-full rounded-2xl border border-white/10',
				'bg-zinc-900 shadow-2xl shadow-black/60',
				widths[size]
			)}
		>
			<header class="flex items-start gap-4 border-b border-white/10 px-6 py-5">
				<div class="min-w-0 flex-1">
					<h2 class="truncate text-base font-semibold text-zinc-100">{title}</h2>
					{#if subtitle}
						<p class="mt-0.5 text-sm text-zinc-500">{subtitle}</p>
					{/if}
				</div>
				<button
					type="button"
					class="-mt-1 -mr-2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
					aria-label={$t('common.close')}
					onclick={onClose}
				>
					<X size={18} />
				</button>
			</header>

			<div class="px-6 py-5">
				{@render children()}
			</div>

			{#if footer}
				<footer
					class="flex items-center justify-end gap-3 rounded-b-2xl border-t border-white/10 bg-zinc-950/40 px-6 py-4"
				>
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}
