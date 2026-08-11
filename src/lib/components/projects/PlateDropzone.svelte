<script lang="ts">
	import { t } from 'svelte-i18n';
	import { FileUp, Loader } from '@lucide/svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import { ParseError, isSupportedFile, parsePrintFile, type ParseResult } from '$lib/utils/threemf';
	import { cn } from '$lib/utils/cn';

	interface Props {
		onParsed: (result: ParseResult) => void;
	}

	let { onParsed }: Props = $props();

	let dragging = $state(false);
	let parsing = $state(false);
	let input = $state<HTMLInputElement | null>(null);
	/**
	 * dragenter/dragleave fire for every child element, so a plain boolean
	 * flickers. Counting entries and exits keeps the highlight stable.
	 */
	let dragDepth = $state(0);

	async function handleFile(file: File | undefined) {
		if (!file || parsing) return;

		if (!isSupportedFile(file.name)) {
			toasts.error('errors.parse.unsupported');
			return;
		}

		parsing = true;
		try {
			onParsed(await parsePrintFile(file));
		} catch (error) {
			if (error instanceof ParseError) {
				toasts.error(error.key, error.values);
			} else {
				toasts.error('errors.parse.corrupt');
			}
		} finally {
			parsing = false;
			if (input) input.value = '';
		}
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragDepth = 0;
		dragging = false;
		handleFile(event.dataTransfer?.files?.[0]);
	}
</script>

<div
	role="button"
	tabindex="0"
	aria-label={$t('plates.dropzone.title')}
	aria-busy={parsing}
	class={cn(
		'flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-200',
		dragging
			? 'border-indigo-400 bg-indigo-500/10 shadow-[0_0_40px_-12px_rgba(99,102,241,0.6)]'
			: 'border-white/15 bg-zinc-900/40 hover:border-indigo-500/50 hover:bg-zinc-900/70',
		parsing && 'pointer-events-none opacity-70'
	)}
	ondragenter={(event) => {
		event.preventDefault();
		dragDepth += 1;
		dragging = true;
	}}
	ondragover={(event) => event.preventDefault()}
	ondragleave={() => {
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) dragging = false;
	}}
	ondrop={onDrop}
	onclick={() => input?.click()}
	onkeydown={(event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			input?.click();
		}
	}}
>
	<div
		class={cn(
			'flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors',
			dragging
				? 'border-indigo-400/40 bg-indigo-500/20 text-indigo-200'
				: 'border-white/10 bg-white/5 text-zinc-400'
		)}
	>
		{#if parsing}
			<Loader size={20} class="animate-spin" />
		{:else}
			<FileUp size={20} />
		{/if}
	</div>

	<div>
		<p class="text-sm font-medium text-zinc-200">
			{#if parsing}
				{$t('plates.dropzone.parsing')}
			{:else if dragging}
				{$t('plates.dropzone.active')}
			{:else}
				{$t('plates.dropzone.title')}
			{/if}
		</p>
		{#if !parsing && !dragging}
			<p class="mt-1 text-xs text-zinc-400">{$t('plates.dropzone.subtitle')}</p>
			<p class="mt-2 text-[11px] text-zinc-400">{$t('plates.dropzone.formats')}</p>
		{/if}
	</div>

	<input
		bind:this={input}
		type="file"
		accept=".3mf,.gcode,.gco"
		class="hidden"
		onchange={(event) => handleFile(event.currentTarget.files?.[0])}
	/>
</div>
