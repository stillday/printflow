<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { t } from 'svelte-i18n';
	import { SearchX } from '@lucide/svelte';
	import EmptyState from './EmptyState.svelte';
	import { cn } from '$lib/utils/cn';

	interface Props {
		/** `loading` renders the centred waiting line, `empty` the illustrated state. */
		variant: 'loading' | 'empty';
		/** Empty only — defaults to the shared "no matches" magnifier. */
		icon?: Component<{ size?: number | string; class?: string }>;
		/** Empty only — defaults to `common.noResults` / `common.noResultsHint`. */
		title?: string;
		body?: string;
		/** Empty only — a button or two, e.g. "reset filters" or "create the first one". */
		action?: Snippet;
		/** Wraps the empty state in a `card`, for screens that show it standalone. */
		card?: boolean;
		class?: string;
	}

	let {
		variant,
		icon = SearchX,
		title,
		body,
		action,
		card = false,
		class: className
	}: Props = $props();
</script>

<!--
	The two states every list screen goes through, so they stop being re-typed
	per route: the loading line appeared five times and the "no matches" card
	three, each with its own padding. `EmptyState` still owns the empty *layout* —
	this only picks the state and fills in the default copy.
-->
{#if variant === 'loading'}
	<p class={cn('py-16 text-center text-sm text-zinc-400', className)}>{$t('common.loading')}</p>
{:else if card}
	<div class={cn('card', className)}>
		<EmptyState
			{icon}
			title={title ?? $t('common.noResults')}
			body={body ?? $t('common.noResultsHint')}
			{action}
		/>
	</div>
{:else}
	<div class={className}>
		<EmptyState
			{icon}
			title={title ?? $t('common.noResults')}
			body={body ?? $t('common.noResultsHint')}
			{action}
		/>
	</div>
{/if}
