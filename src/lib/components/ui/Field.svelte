<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t } from 'svelte-i18n';

	/**
	 * Label, hint and validation message around one form control.
	 *
	 * The control is wrapped in the `<label>` rather than tied to it by `for`/`id`:
	 * that associates the two implicitly, so every input gets an accessible name
	 * and clicking the caption focuses the field, without each of the ~30 call
	 * sites having to thread an id through. The trade-off is that the error text
	 * cannot be an `aria-describedby` target, so it carries `role="alert"` and is
	 * announced when it appears instead.
	 */
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
	<label>
		<span class="mb-1.5 flex items-baseline justify-between gap-2">
			<span class="text-xs font-medium tracking-wide text-zinc-400 uppercase">{label}</span>
			{#if optional}
				<span class="text-2xs tracking-wide text-zinc-400 uppercase">
					{$t('common.optional')}
				</span>
			{/if}
		</span>

		{@render children()}
	</label>

	{#if error}
		<p class="mt-1.5 text-xs text-rose-400" role="alert">{$t(error)}</p>
	{:else if hint}
		<p class="mt-1.5 text-xs text-zinc-400">{hint}</p>
	{/if}
</div>
