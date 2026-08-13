<script lang="ts">
	import { t } from 'svelte-i18n';
	import { Moon, Sun } from '@lucide/svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { toasts } from '$lib/stores/toast.svelte';

	/**
	 * One-click flip between light and dark. It always sets an explicit
	 * preference — a `system` choice is available in Settings, but a user
	 * reaching for this button wants the other theme now, not a rule.
	 */
	async function toggle() {
		const next = theme.resolved === 'dark' ? 'light' : 'dark';
		try {
			await theme.set(next);
		} catch {
			// The theme already switched; only remembering it failed.
			toasts.error('errors.saveFailed');
		}
	}
</script>

<button
	type="button"
	class="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:border-indigo-500/40 hover:text-zinc-100"
	onclick={toggle}
	title={$t(theme.resolved === 'dark' ? 'settings.themeToLight' : 'settings.themeToDark')}
	aria-label={$t(theme.resolved === 'dark' ? 'settings.themeToLight' : 'settings.themeToDark')}
>
	{#if theme.resolved === 'dark'}
		<Sun size={15} />
	{:else}
		<Moon size={15} />
	{/if}
</button>
