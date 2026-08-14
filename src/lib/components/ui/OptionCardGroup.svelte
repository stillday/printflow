<script lang="ts">
	import type { Component } from 'svelte';
	import { Check } from '@lucide/svelte';
	import { cn } from '$lib/utils/cn';

	interface Option {
		value: string;
		label: string;
		/** Second line: the resolved system theme, a locale code, a consequence. */
		hint?: string;
		icon?: Component<{ size?: number | string; class?: string }>;
	}

	interface Props {
		options: Option[];
		value: string;
		/** Names the whole group, e.g. "Erscheinungsbild". Required — a radio
		 *  group without a label is announced as a bare "radio group". */
		label: string;
		columns?: 2 | 3;
		onchange: (value: string) => void;
		class?: string;
	}

	let { options, value, label, columns = 3, onchange, class: className }: Props = $props();

	/*
	 * These cards are one choice out of a set, so they are a radio group — not
	 * the three independent `aria-pressed` toggles they used to be, which is what
	 * a screen reader heard before ("button, pressed" three times over, with no
	 * hint that picking one clears the others and no arrow-key movement).
	 *
	 * That means the full radiogroup contract: a roving tabindex (the group is a
	 * single tab stop, landing on the current choice), arrow keys to move, and
	 * Home/End for the ends. Moving also selects, as native radios do.
	 */
	let buttons = $state<(HTMLButtonElement | null)[]>([]);

	// Falls back to the first card so an unknown value still leaves a tab stop.
	const activeIndex = $derived(
		Math.max(
			0,
			options.findIndex((option) => option.value === value)
		)
	);

	function select(index: number) {
		const option = options[index];
		if (!option) return;
		buttons[index]?.focus();
		if (option.value !== value) onchange(option.value);
	}

	function onKeydown(event: KeyboardEvent, index: number) {
		const last = options.length - 1;
		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				event.preventDefault();
				select(index === last ? 0 : index + 1);
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				event.preventDefault();
				select(index === 0 ? last : index - 1);
				break;
			case 'Home':
				event.preventDefault();
				select(0);
				break;
			case 'End':
				event.preventDefault();
				select(last);
				break;
		}
	}
</script>

<div
	role="radiogroup"
	aria-label={label}
	class={cn('grid gap-2', columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3', className)}
>
	{#each options as option, index (option.value)}
		{@const selected = option.value === value}
		<button
			bind:this={buttons[index]}
			type="button"
			role="radio"
			aria-checked={selected}
			tabindex={index === activeIndex ? 0 : -1}
			class={cn(
				'flex items-start justify-between gap-2 rounded-xl border px-4 py-3 text-left text-sm transition-colors',
				selected
					? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200'
					: 'border-white/10 bg-zinc-950/40 text-zinc-300 hover:border-white/20 hover:bg-white/5'
			)}
			onclick={() => onchange(option.value)}
			onkeydown={(event) => onKeydown(event, index)}
		>
			<span class="flex min-w-0 items-start gap-2">
				{#if option.icon}
					<option.icon size={15} class="mt-0.5 shrink-0" />
				{/if}
				<span class="min-w-0">
					<span class="block font-medium">{option.label}</span>
					{#if option.hint}
						<span class="mt-0.5 block text-[11px] leading-snug text-zinc-400">{option.hint}</span>
					{/if}
				</span>
			</span>
			{#if selected}
				<!-- Decorative: `aria-checked` already carries the state. -->
				<Check size={16} class="mt-0.5 shrink-0" />
			{/if}
		</button>
	{/each}
</div>
