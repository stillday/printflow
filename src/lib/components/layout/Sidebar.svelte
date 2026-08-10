<script lang="ts">
	import { page } from '$app/state';
	import { t } from 'svelte-i18n';
	import { Boxes, FolderKanban, LayoutDashboard, Layers, Settings } from '@lucide/svelte';
	import { cn } from '$lib/utils/cn';

	const primary = [
		{ href: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
		{ href: '/spools', labelKey: 'nav.spools', icon: Boxes },
		{ href: '/catalog', labelKey: 'nav.catalog', icon: Layers },
		{ href: '/projects', labelKey: 'nav.projects', icon: FolderKanban }
	];

	const secondary = [{ href: '/settings', labelKey: 'nav.settings', icon: Settings }];

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
	}
</script>

<aside
	class="flex w-60 shrink-0 flex-col border-r border-white/10 bg-zinc-950/60 backdrop-blur-xl"
>
	<div class="flex items-center gap-3 px-5 py-5">
		<div
			class="flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/30 to-indigo-600/10 shadow-lg shadow-indigo-950/40"
		>
			<Layers size={17} class="text-indigo-300" />
		</div>
		<div class="min-w-0">
			<p class="truncate text-sm font-semibold text-zinc-100">{$t('app.name')}</p>
			<p class="truncate text-[11px] text-zinc-600">{$t('app.tagline')}</p>
		</div>
	</div>

	<nav class="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-2">
		{#snippet section(labelKey: string, items: typeof primary)}
			<div>
				<p class="px-3 pb-2 text-[10px] font-semibold tracking-widest text-zinc-600 uppercase">
					{$t(labelKey)}
				</p>
				<ul class="flex flex-col gap-1">
					{#each items as item (item.href)}
						{@const active = isActive(item.href)}
						<li>
							<a
								href={item.href}
								aria-current={active ? 'page' : undefined}
								class={cn(
									'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
									active
										? 'border border-indigo-500/30 bg-indigo-500/10 text-indigo-200 shadow-lg shadow-indigo-950/30'
										: 'border border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
								)}
							>
								{#if active}
									<span
										class="absolute top-1/2 -left-3 h-5 w-1 -translate-y-1/2 rounded-r-full bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.8)]"
										aria-hidden="true"
									></span>
								{/if}
								<item.icon
									size={17}
									class={active ? 'text-indigo-300' : 'text-zinc-500 group-hover:text-zinc-300'}
								/>
								<span class="truncate">{$t(item.labelKey)}</span>
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/snippet}

		{@render section('nav.section.main', primary)}
		{@render section('nav.section.system', secondary)}
	</nav>

	<div class="border-t border-white/10 px-5 py-4">
		<div class="flex items-center gap-2">
			<span
				class="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"
				aria-hidden="true"
			></span>
			<span class="text-[11px] font-medium text-emerald-400">{$t('app.offline')}</span>
		</div>
		<p class="mt-1 text-[11px] leading-snug text-zinc-600">{$t('app.offlineHint')}</p>
	</div>
</aside>
