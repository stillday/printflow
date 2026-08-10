<script lang="ts">
	import { locale, t } from 'svelte-i18n';
	import { Check, Globe } from '@lucide/svelte';
	import { SUPPORTED_LOCALES, setLocale, type AppLocale } from '$lib/i18n';
	import { SETTING_LOCALE, setSetting } from '$lib/db/settings';
	import { toasts } from '$lib/stores/toast.svelte';
	import { cn } from '$lib/utils/cn';

	let open = $state(false);
	let root = $state<HTMLDivElement | null>(null);

	const current = $derived(($locale ?? 'de') as AppLocale);

	async function choose(next: AppLocale) {
		open = false;
		if (next === current) return;

		setLocale(next);
		try {
			await setSetting(SETTING_LOCALE, next);
			toasts.success('toast.languageChanged');
		} catch {
			// The switch already applied; only persistence failed.
			toasts.error('errors.saveFailed');
		}
	}

	function onWindowPointerDown(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window
	onpointerdown={onWindowPointerDown}
	onkeydown={(event) => event.key === 'Escape' && (open = false)}
/>

<div class="relative" bind:this={root}>
	<button
		type="button"
		class="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium text-zinc-300 transition-colors hover:border-indigo-500/40 hover:text-zinc-100"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-label={$t('settings.language')}
		onclick={() => (open = !open)}
	>
		<Globe size={15} class="text-zinc-500" />
		<span class="uppercase">{current}</span>
	</button>

	{#if open}
		<ul
			class="animate-pop-in absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-2xl shadow-black/60"
			role="listbox"
			aria-label={$t('settings.language')}
		>
			{#each SUPPORTED_LOCALES as code (code)}
				<li>
					<button
						type="button"
						role="option"
						aria-selected={code === current}
						class={cn(
							'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
							code === current
								? 'bg-indigo-500/10 text-indigo-200'
								: 'text-zinc-300 hover:bg-white/5 hover:text-zinc-100'
						)}
						onclick={() => choose(code)}
					>
						<span>{$t(`languages.${code}`)}</span>
						{#if code === current}
							<Check size={14} />
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
