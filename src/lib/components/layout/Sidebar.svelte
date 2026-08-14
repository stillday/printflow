<script lang="ts">
	import { page } from '$app/state';
	import { t } from 'svelte-i18n';
	import {
		Boxes,
		CalendarDays,
		FolderKanban,
		FolderSearch,
		LayoutDashboard,
		Layers,
		Settings
	} from '@lucide/svelte';
	import { cn } from '$lib/utils/cn';
	import { layout } from '$lib/stores/layout.svelte';

	const primary = [
		{ href: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
		{ href: '/spools', labelKey: 'nav.spools', icon: Boxes },
		{ href: '/catalog', labelKey: 'nav.catalog', icon: Layers },
		{ href: '/projects', labelKey: 'nav.projects', icon: FolderKanban },
		{ href: '/plan', labelKey: 'nav.plan', icon: CalendarDays },
		{ href: '/files', labelKey: 'nav.files', icon: FolderSearch }
	];

	const secondary = [{ href: '/settings', labelKey: 'nav.settings', icon: Settings }];

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
	}
</script>

<!--
	Width comes from `--pf-sidebar-w`, so a layout can trade the labelled sidebar
	for a 48px icon rail without a second component. Only one thing genuinely
	branches: whether the labels render at all — everything else is a token.
-->
<aside
	class="flex shrink-0 flex-col border-r border-white/10 bg-zinc-950/60"
	style="width: var(--pf-sidebar-w)"
>
	<div class={cn('flex items-center gap-3 py-5', layout.iconRail ? 'justify-center px-0' : 'px-5')}>
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/30 to-indigo-600/10 shadow-lg shadow-indigo-950/40"
			title={layout.iconRail ? $t('app.name') : undefined}
		>
			<Layers size={17} class="text-indigo-300" />
		</div>
		{#if !layout.iconRail}
			<div class="min-w-0">
				<p class="truncate text-sm font-semibold text-zinc-100">{$t('app.name')}</p>
				<p class="truncate text-xs text-zinc-400">{$t('app.tagline')}</p>
			</div>
		{/if}
	</div>

	<nav
		class={cn('flex flex-1 flex-col overflow-y-auto py-2', layout.iconRail ? 'gap-2 px-2' : 'gap-6 px-3')}
	>
		{#snippet section(labelKey: string, items: typeof primary)}
			<div>
				{#if !layout.iconRail}
					<p class="px-3 pb-2 text-2xs font-semibold tracking-widest text-zinc-400 uppercase">
						{$t(labelKey)}
					</p>
				{/if}
				<ul class="flex flex-col gap-1">
					{#each items as item (item.href)}
						{@const active = isActive(item.href)}
						<li>
							<a
								href={item.href}
								aria-current={active ? 'page' : undefined}
								title={layout.iconRail ? $t(item.labelKey) : undefined}
								aria-label={layout.iconRail ? $t(item.labelKey) : undefined}
								class={cn(
									'group relative flex items-center rounded-xl text-sm font-medium transition-all duration-150',
									layout.iconRail ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
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
									class={active ? 'text-indigo-300' : 'text-zinc-400 group-hover:text-zinc-300'}
								/>
								{#if !layout.iconRail}
									<span class="truncate">{$t(item.labelKey)}</span>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/snippet}

		{@render section('nav.section.main', primary)}
		{@render section('nav.section.system', secondary)}
	</nav>

	<div class={cn('border-t border-white/10 py-4', layout.iconRail ? 'px-0' : 'px-5')}>
		<div class={cn('flex items-center gap-2', layout.iconRail && 'justify-center')}>
			<span
				class="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"
				aria-hidden="true"
			></span>
			<span class="text-xs font-medium text-emerald-400">{$t('app.offline')}</span>
		</div>
		<p class="mt-1 text-xs leading-snug text-zinc-400">{$t('app.offlineHint')}</p>
	</div>
</aside>
