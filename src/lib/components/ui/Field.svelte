<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t } from 'svelte-i18n';

	interface Props {
		label: string;
		/** i18n key of a validation message, or null when the field is valid. */
		error?: string | null;
		hint?: string;
		optional?: boolean;
		children: Snippet;
	}

	let { label, error = null, hint, optional = false, children }: Props = $props();
</script>

<div>
	<div class="mb-1.5 flex items-baseline justify-between gap-2">
		<span class="text-xs font-medium tracking-wide text-zinc-400 uppercase">{label}</span>
		{#if optional}
			<span class="text-[10px] tracking-wide text-zinc-400 uppercase">{$t('common.optional')}</span>
		{/if}
	</div>

	{@render children()}

	{#if error}
		<p class="mt-1.5 text-xs text-rose-400">{$t(error)}</p>
	{:else if hint}
		<p class="mt-1.5 text-xs text-zinc-400">{hint}</p>
	{/if}
</div>
