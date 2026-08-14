<script lang="ts">
	import { goto } from '$app/navigation';
	import { t } from 'svelte-i18n';
	import { Boxes, FolderKanban, Layers, Layers3, Puzzle, Search } from '@lucide/svelte';
	import LanguageSwitcher from './LanguageSwitcher.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import ColorSwatch from '$lib/components/ui/ColorSwatch.svelte';
	import { quickSearch, type SearchHit } from '$lib/db/search';
	import { cn } from '$lib/utils/cn';

	const SEARCH_DEBOUNCE_MS = 180;
	const LISTBOX_ID = 'quick-search-listbox';

	let term = $state('');
	let hits = $state<SearchHit[]>([]);
	let open = $state(false);
	let activeIndex = $state(0);
	let root = $state<HTMLDivElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	const icons = {
		project: FolderKanban,
		part: Puzzle,
		plate: Layers3,
		spool: Boxes,
		catalog: Layers
	} as const;

	/** Category badge per hit — reuses the sidebar and project tab wording. */
	const kindLabelKeys: Record<SearchHit['kind'], string> = {
		project: 'nav.projects',
		part: 'projects.tabs.parts',
		plate: 'projects.tabs.plates',
		spool: 'nav.spools',
		catalog: 'nav.catalog'
	};

	const optionId = (index: number) => `quick-search-option-${index}`;

	// The hint has to name the key the user actually has. `navigator.platform` is
	// deprecated but remains the only synchronous platform signal in a WebView,
	// and the modifier itself is handled for both variants below anyway.
	const isMac =
		typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent);

	// Debounced so typing does not fire a query per keystroke. A stale response
	// is discarded by comparing the term it was issued for.
	$effect(() => {
		const query = term;
		if (query.trim().length < 2) {
			hits = [];
			open = false;
			return;
		}

		const timer = setTimeout(async () => {
			try {
				const result = await quickSearch(query);
				if (query !== term) return;
				hits = result;
				activeIndex = 0;
				open = true;
			} catch {
				hits = [];
			}
		}, SEARCH_DEBOUNCE_MS);

		return () => clearTimeout(timer);
	});

	// Five entity kinds can contribute hits, so the list scrolls. Focus never
	// leaves the input in a combobox, which means nothing scrolls the highlighted
	// option into view on its own.
	$effect(() => {
		if (!open || hits.length === 0) return;
		document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
	});

	function select(hit: SearchHit) {
		open = false;
		term = '';
		goto(hit.href);
	}

	function onKeydown(event: KeyboardEvent) {
		if (!open || hits.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeIndex = (activeIndex + 1) % hits.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeIndex = (activeIndex - 1 + hits.length) % hits.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			select(hits[activeIndex]);
		} else if (event.key === 'Escape') {
			open = false;
		}
	}

	// Ctrl/Cmd+K focuses search, the shortcut users of desktop apps expect.
	function onGlobalKeydown(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			input?.focus();
			input?.select();
		}
	}

	function onPointerDown(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onkeydown={onGlobalKeydown} onpointerdown={onPointerDown} />

<header
	class="flex h-16 shrink-0 items-center gap-4 border-b border-white/10 bg-zinc-950/60 px-6 backdrop-blur-xl"
>
	<div class="relative w-full max-w-md" bind:this={root}>
		<Search
			size={15}
			class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400"
		/>
		<!--
			ARIA 1.2 combobox: the input keeps focus and points at the highlighted
			option via `aria-activedescendant`, so a screen reader follows the same
			arrow keys a sighted user sees move the highlight.
		-->
		<input
			bind:this={input}
			bind:value={term}
			type="search"
			role="combobox"
			class="input-base h-9 pr-24 pl-9"
			placeholder={$t('search.placeholder')}
			aria-label={$t('common.search')}
			aria-expanded={open}
			aria-controls={open ? LISTBOX_ID : undefined}
			aria-activedescendant={open && hits.length > 0 ? optionId(activeIndex) : undefined}
			aria-autocomplete="list"
			aria-keyshortcuts="Control+K Meta+K"
			autocomplete="off"
			onkeydown={onKeydown}
			onfocus={() => hits.length > 0 && (open = true)}
		/>

		<!--
			The shortcut existed but was invisible. Hidden as soon as there is text,
			where it would collide with the search field's native clear button, and
			hidden from screen readers, which get `aria-keyshortcuts` instead.

			The input reserves `pr-24` for them: at the token scale "Strg"+"K" needs
			more than the 5rem the 10px hardcode used to fit into.
		-->
		{#if term.length === 0}
			<span
				class="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1"
				aria-hidden="true"
			>
				<kbd
					class="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-sans text-xs text-zinc-400"
				>
					{isMac ? '⌘' : $t('search.shortcutModifier')}
				</kbd>
				<kbd
					class="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-sans text-xs text-zinc-400"
				>
					K
				</kbd>
			</span>
		{/if}

		{#if open}
			<div
				class="animate-pop-in absolute top-full right-0 left-0 z-50 mt-2 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-2xl shadow-black/60"
			>
				{#if hits.length === 0}
					<p class="px-4 py-3 text-sm text-zinc-400" role="status">{$t('common.noResults')}</p>
				{/if}
				<!--
					Rendered even while empty: `aria-controls` on the input has to resolve
					to something for the relationship to exist at all.
				-->
				<ul
					id={LISTBOX_ID}
					role="listbox"
					aria-label={$t('search.resultsLabel')}
					class="max-h-[60vh] overflow-y-auto"
				>
					{#each hits as hit, index (hit.kind + hit.id)}
						{@const Icon = icons[hit.kind]}
						<li role="presentation">
							<button
								type="button"
								id={optionId(index)}
								role="option"
								aria-selected={index === activeIndex}
								tabindex="-1"
								class={cn(
									'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
									index === activeIndex ? 'bg-white/5' : 'hover:bg-white/5'
								)}
								onclick={() => select(hit)}
								onmouseenter={() => (activeIndex = index)}
							>
								{#if hit.colorHex}
									<ColorSwatch color={hit.colorHex} size={16} />
								{:else}
									<Icon size={16} class="shrink-0 text-zinc-400" />
								{/if}
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm text-zinc-200">{hit.title}</span>
									<span class="block truncate text-xs text-zinc-400">
										{hit.subtitleKey ? $t(hit.subtitleKey) : hit.subtitle}
									</span>
								</span>
								<span class="shrink-0 text-2xs tracking-wide text-zinc-400 uppercase">
									{$t(kindLabelKeys[hit.kind])}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>

	<div class="ml-auto flex items-center gap-2">
		<ThemeToggle />
		<LanguageSwitcher />
	</div>
</header>
