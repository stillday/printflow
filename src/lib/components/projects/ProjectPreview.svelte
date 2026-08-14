<script lang="ts">
	import { t } from 'svelte-i18n';
	import { save as saveDialog } from '@tauri-apps/plugin-dialog';
	import {
		CloudDownload,
		ExternalLink,
		Image as ImageIcon,
		Loader,
		RefreshCw,
		Trash2
	} from '@lucide/svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import {
		commandError,
		deletePreview,
		downloadFile,
		fetchModelPreview,
		fetchPreviewViaBrowser,
		fileNameFromPath,
		fileNameFromUrl,
		getPreview,
		isModelPortalUrl,
		previewDataUri,
		savePreview,
		urlHost,
		type ProjectPreview
	} from '$lib/db/previews';
	import { online } from '$lib/stores/online.svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import { formatBytes, formatDateTime } from '$lib/utils/format';
	import { isExternalUrl, openExternal } from '$lib/utils/external';
	import { cn } from '$lib/utils/cn';
	import { optionalUrl, requiredText } from '$lib/utils/validate';

	/**
	 * A project's preview image, plus the two honest ways to get at the model's
	 * files.
	 *
	 * The image is fetched once by a Rust command and then lives in the database;
	 * what is rendered here is always the stored bytes as a `data:` URI, never a
	 * remote address — the WebView's CSP is `'self'` and stays that way.
	 */
	interface Props {
		projectId: number;
		/** The project's link. Null, unsupported or non-http links simply offer less. */
		sourceUrl: string | null | undefined;
		/** `card` for a page section, `inline` for a compact box inside a modal. */
		variant?: 'card' | 'inline';
		/**
		 * The download tools are page furniture, not modal furniture — a dialog for
		 * editing a project is the wrong place to start a file transfer.
		 */
		downloads?: boolean;
		/** Fires after the stored image changed, so a list can refresh its thumbnails. */
		onChanged?: (hasPreview: boolean) => void;
	}

	let {
		projectId,
		sourceUrl,
		variant = 'card',
		downloads = variant === 'card',
		onChanged
	}: Props = $props();

	let preview = $state<ProjectPreview | null>(null);
	let loading = $state(true);
	let fetching = $state(false);
	/** Set after a silent attempt failed, to offer the visible reader window. */
	let needsHuman = $state(false);
	let downloadOpen = $state(false);
	let downloadUrl = $state('');
	let downloadSubmitted = $state(false);
	let downloading = $state(false);

	const host = $derived(urlHost(sourceUrl));
	const supported = $derived(isModelPortalUrl(sourceUrl));
	/** The button only appears where it can actually work; Rust enforces the rest. */
	const canFetch = $derived(supported && online.enabled);
	const imageHost = $derived(urlHost(preview?.imageUrl));

	const downloadUrlError = $derived(requiredText(downloadUrl) ?? optionalUrl(downloadUrl));
	const downloadUrlShown = $derived(downloadSubmitted ? downloadUrlError : null);

	// Guards against a slow read for the previous project landing after the user
	// has already switched to another one.
	let requestId = 0;

	async function load(id: number) {
		const token = ++requestId;
		try {
			const found = await getPreview(id);
			if (token === requestId) preview = found;
		} catch {
			if (token === requestId) toasts.error('errors.loadFailed');
		} finally {
			if (token === requestId) loading = false;
		}
	}

	$effect(() => {
		const id = projectId;
		loading = true;
		preview = null;
		void load(id);
	});

	/**
	 * Reads the model page and stores its picture.
	 *
	 * Two paths, tried in that order for a reason: a plain HTTP request is cheap
	 * and invisible, but MakerWorld and Printables answer it with 403 — their bot
	 * protection wants a real browser engine. So on failure the app falls back to
	 * loading the page in an offscreen WebView. If even that reports nothing, the
	 * portal is showing a check that only a human can clear, and `visible` opens
	 * the same window so the user can do it once.
	 */
	async function fetchPreview(visible = false) {
		const url = sourceUrl?.trim();
		// `online.enabled` is re-checked here and not only in the markup: the switch
		// can be flipped in another tab of the app while this card is on screen.
		if (!url || fetching || !canFetch) return;

		fetching = true;
		try {
			let fetched;
			if (visible) {
				fetched = await fetchPreviewViaBrowser(url, true);
			} else {
				try {
					fetched = await fetchModelPreview(url);
				} catch {
					fetched = await fetchPreviewViaBrowser(url, false);
				}
			}
			await savePreview({
				projectId,
				imageBase64: fetched.imageBase64,
				contentType: fetched.contentType,
				imageUrl: fetched.imageUrl,
				sourceUrl: url
			});
			// Read back rather than assemble the row by hand, so `fetchedAt` is the
			// value the database actually stored.
			preview = await getPreview(projectId);
			toasts.success('portal.toast.previewFetched');
			onChanged?.(true);
		} catch (error) {
			const reason = commandError(error);
			// The Rust command answers in sentences ("the page answered 404"); passing
			// that through is the difference between a fixable and a mysterious error.
			if (reason) {
				toasts.error('portal.errors.fetchFailed', { reason });
			} else {
				toasts.error('portal.errors.fetchFailedGeneric');
			}
			// A failed silent attempt is usually a bot check, which only a human can
			// clear — so offer the visible window rather than leaving a dead end.
			needsHuman = !visible;
		} finally {
			fetching = false;
		}
	}

	async function removePreview() {
		try {
			await deletePreview(projectId);
			preview = null;
			toasts.success('portal.toast.previewRemoved');
			onChanged?.(false);
		} catch {
			toasts.error('errors.deleteFailed');
		}
	}

	async function openLink(url: string) {
		try {
			await openExternal(url);
		} catch {
			toasts.error('errors.openFailed');
		}
	}

	async function startDownload() {
		downloadSubmitted = true;
		const url = downloadUrl.trim();
		if (downloadUrlError || downloading || !online.enabled) return;

		downloading = true;
		try {
			const target = await saveDialog({
				title: $t('portal.download.dialogTitle'),
				defaultPath: fileNameFromUrl(url)
			});
			if (!target) return;

			const bytes = await downloadFile(url, target);
			toasts.success('portal.toast.downloaded', {
				name: fileNameFromPath(target),
				size: formatBytes(bytes)
			});
			downloadUrl = '';
			downloadSubmitted = false;
			downloadOpen = false;
		} catch (error) {
			const reason = commandError(error);
			if (reason) {
				toasts.error('portal.errors.downloadFailed', { reason });
			} else {
				toasts.error('portal.errors.downloadFailedGeneric');
			}
		} finally {
			downloading = false;
		}
	}
</script>

{#snippet settingsHint(text: string)}
	<!-- The offline case is stated, not hidden: a missing button reads as a bug. -->
	<p class="text-xs leading-relaxed text-zinc-400">
		{text}
		<a
			href="/settings"
			class="text-indigo-300 underline underline-offset-2 transition-colors hover:text-indigo-200"
		>
			{$t('portal.offline.settings')}
		</a>
	</p>
{/snippet}

<section class={cn(variant === 'card' ? 'card p-5' : 'rounded-xl border border-white/10 p-4')}>
	<div class="flex items-center gap-3">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-300"
		>
			<ImageIcon size={17} />
		</div>
		<div class="min-w-0">
			<h2 class="text-sm font-semibold text-zinc-100">{$t('portal.preview.title')}</h2>
			<p class="mt-0.5 text-xs text-zinc-400">{$t('portal.preview.hint')}</p>
		</div>
	</div>

	<div class="mt-4">
		{#if loading}
			<p class="text-xs text-zinc-400">{$t('common.loading')}</p>
		{:else if preview}
			<!-- Bound once so the handler below keeps the narrowed, non-null type. -->
			{@const stored = preview}
			<!--
				Always the stored bytes as a `data:` URI. Pointing this `src` at
				`preview.imageUrl` would be the one line that puts the UI back on the
				network — the CSP would block it, and the image would silently vanish.
			-->
			<img
				src={previewDataUri(stored)}
				alt={$t('portal.preview.alt')}
				class={cn(
					'w-full rounded-xl border border-white/10 bg-zinc-950/60 object-contain',
					variant === 'card' ? 'max-h-72' : 'max-h-40'
				)}
			/>

			<div class="mt-3 flex flex-wrap items-center justify-between gap-3">
				<p class="min-w-0 text-xs leading-relaxed text-zinc-400">
					{#if imageHost && stored.imageUrl && isExternalUrl(stored.imageUrl)}
						{@const imageLink = stored.imageUrl}
						<button
							type="button"
							class="inline-flex items-center gap-1 text-indigo-300 transition-colors hover:text-indigo-200"
							onclick={() => openLink(imageLink)}
						>
							{$t('portal.preview.from', { values: { host: imageHost } })}
							<ExternalLink size={11} />
						</button>
					{:else}
						{$t('portal.preview.fromUnknown')}
					{/if}
					<span class="text-zinc-400">
						· {$t('portal.preview.fetchedAt', {
							values: { date: formatDateTime(stored.fetchedAt) }
						})}
					</span>
				</p>

				<div class="flex shrink-0 items-center gap-2">
					{#if canFetch}
						<Button variant="ghost" size="sm" onclick={() => fetchPreview()} disabled={fetching}>
							{#if fetching}
								<Loader size={14} class="animate-spin" />
							{:else}
								<RefreshCw size={14} />
							{/if}
							{fetching ? $t('portal.preview.fetching') : $t('portal.preview.refetch')}
						</Button>
					{/if}
					<Button variant="danger" size="sm" onclick={removePreview} disabled={fetching}>
						<Trash2 size={14} />
						{$t('portal.preview.remove')}
					</Button>
				</div>
			</div>

			{#if supported && !online.enabled}
				<div class="mt-2">
					{@render settingsHint($t('portal.offline.refetch'))}
				</div>
			{/if}
		{:else if !host}
			<p class="text-xs leading-relaxed text-zinc-400">{$t('portal.preview.noSource')}</p>
		{:else if !supported}
			<p class="text-xs leading-relaxed text-zinc-400">
				{$t('portal.preview.unsupported', { values: { host } })}
			</p>
			<p class="mt-1 text-xs text-zinc-400">
				{$t('portal.supported', { values: { portals: $t('portal.portalList') } })}
			</p>
		{:else if !online.enabled}
			{@render settingsHint($t('portal.offline.fetch'))}
		{:else}
			<p class="text-xs leading-relaxed text-zinc-400">
				{$t('portal.preview.emptyBody', { values: { host } })}
			</p>
			<div class="mt-3">
				{#if needsHuman}
					<p class="mb-3 text-xs leading-relaxed text-amber-300">
						{$t('portal.preview.needsHuman')}
					</p>
					<Button
						variant="secondary"
						size="sm"
						class="mb-2"
						onclick={() => fetchPreview(true)}
						disabled={fetching}
					>
						<ExternalLink size={14} />
						{$t('portal.preview.openReader')}
					</Button>
				{/if}
				<Button variant="primary" size="sm" onclick={() => fetchPreview()} disabled={fetching}>
					{#if fetching}
						<Loader size={14} class="animate-spin" />
					{:else}
						<CloudDownload size={14} />
					{/if}
					{fetching ? $t('portal.preview.fetching') : $t('portal.preview.fetch')}
				</Button>
			</div>
		{/if}
	</div>

	{#if downloads}
		<div class="mt-5 border-t border-white/10 pt-4">
			<p class="text-xs font-medium text-zinc-200">{$t('portal.download.title')}</p>
			<!--
				Said plainly rather than papered over: the portals hand out their
				download endpoints only to a signed-in session, which this app has no
				business holding. So the honest offer is "open the page in your browser"
				plus "paste a link you already have".
			-->
			<p class="mt-1 text-xs leading-relaxed text-zinc-400">{$t('portal.download.body')}</p>

			<div class="mt-3 flex flex-wrap gap-2">
				{#if isExternalUrl(sourceUrl)}
					<Button variant="secondary" size="sm" onclick={() => openLink(sourceUrl!.trim())}>
						<ExternalLink size={14} />
						{$t('portal.download.openPage')}
					</Button>
				{/if}
				<Button
					variant="ghost"
					size="sm"
					aria-expanded={downloadOpen}
					onclick={() => (downloadOpen = !downloadOpen)}
				>
					<CloudDownload size={14} />
					{$t('portal.download.direct')}
				</Button>
			</div>

			{#if downloadOpen}
				<div class="mt-3 rounded-xl border border-white/10 bg-zinc-950/40 p-4">
					{#if online.enabled}
						<p class="mb-3 text-xs leading-relaxed text-zinc-400">
							{$t('portal.download.directHint')}
						</p>
						<Field label={$t('portal.download.urlLabel')} error={downloadUrlShown}>
							<input
								class="input-base"
								bind:value={downloadUrl}
								placeholder={$t('portal.download.urlPlaceholder')}
								spellcheck="false"
							/>
						</Field>
						<div class="mt-3 flex flex-wrap items-center gap-3">
							<Button variant="primary" size="sm" onclick={startDownload} disabled={downloading}>
								{#if downloading}
									<Loader size={14} class="animate-spin" />
								{:else}
									<CloudDownload size={14} />
								{/if}
								{downloading ? $t('portal.download.busy') : $t('portal.download.start')}
							</Button>
							<p class="text-xs leading-relaxed text-zinc-400">
								{$t('portal.download.overwriteHint')}
							</p>
						</div>
					{:else}
						{@render settingsHint($t('portal.offline.download'))}
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</section>
