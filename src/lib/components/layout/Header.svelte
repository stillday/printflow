<script lang="ts">
	import { goto } from '$app/navigation';
	import { t } from 'svelte-i18n';
	import { Boxes, FolderKanban, Layers, Search } from '@lucide/svelte';
	import LanguageSwitcher from './LanguageSwitcher.svelte';
	import ColorSwatch from '$lib/components/ui/ColorSwatch.svelte';
	import { quickSearch, type SearchHit } from '$lib/db/search';
	import { cn } from '$lib/utils/cn';

	const SEARCH_DEBOUNCE_MS = 180;

	let term = $state('');
	let hits = $state<SearchHit[]>([]);
	let open = $state(false);
	let activeIndex = $state(0);
	let root = $state<HTMLDivElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	const icons = { project: FolderKanban, spool: Boxes, catalog: Layers } as const;

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
			class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-600"
		/>
		<input
			bind:this={input}
			bind:value={term}
			type="search"
			class="input-base h-9 pl-9"
			placeholder={$t('common.searchPlaceholder')}
			aria-label={$t('common.search')}
			autocomplete="off"
			onkeydown={onKeydown}
			onfocus={() => hits.length > 0 && (open = true)}
		/>

		{#if open}
			<div
				class="animate-pop-in absolute top-full right-0 left-0 z-50 mt-2 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-2xl shadow-black/60"
			>
				{#if hits.length === 0}
					<p class="px-4 py-3 text-sm text-zinc-500">{$t('common.noResults')}</p>
				{:else}
					<ul>
						{#each hits as hit, index (hit.kind + hit.id)}
							{@const Icon = icons[hit.kind]}
							<li>
								<button
									type="button"
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
										<Icon size={16} class="shrink-0 text-zinc-500" />
									{/if}
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm text-zinc-200">{hit.title}</span>
										<span class="block truncate text-xs text-zinc-500">
											{hit.subtitleKey ? $t(hit.subtitleKey) : hit.subtitle}
										</span>
									</span>
									<span class="shrink-0 text-[10px] tracking-wide text-zinc-600 uppercase">
										{$t(`nav.${hit.kind === 'project' ? 'projects' : hit.kind === 'spool' ? 'spools' : 'catalog'}`)}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>

	<div class="ml-auto flex items-center gap-3">
		<LanguageSwitcher />
	</div>
</header>
