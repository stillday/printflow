<script lang="ts">
	import { t } from 'svelte-i18n';
	import { CloudDownload, Loader } from '@lucide/svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import ProjectPreview from '$lib/components/projects/ProjectPreview.svelte';
	import { createProject, updateProject } from '$lib/db/projects';
	import { commandError, fetchModelPreview, isModelPortalUrl } from '$lib/db/previews';
	import { online } from '$lib/stores/online.svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import { PROJECT_STATUSES, type Project, type ProjectStatus } from '$lib/types/schema';
	import { isValid, optionalUrl, requiredText } from '$lib/utils/validate';

	interface Props {
		open: boolean;
		project: Project | null;
		onClose: () => void;
		onSaved: (id: number) => void;
	}

	let { open, project, onClose, onSaved }: Props = $props();

	let title = $state('');
	let description = $state('');
	let sourceUrl = $state('');
	let status = $state<ProjectStatus>('planning');
	let submitted = $state(false);
	let busy = $state(false);

	let titleBusy = $state(false);
	/**
	 * A fetched page title, remembered together with the link it came from.
	 *
	 * It is only ever *offered*: typing a name and then fetching a title must not
	 * silently replace what was typed. Storing the link alongside also retires the
	 * suggestion by itself once the URL is edited — a title from the old link is
	 * not an answer to the new one.
	 */
	let suggested = $state<{ url: string; title: string } | null>(null);

	$effect(() => {
		if (!open) return;
		title = project?.title ?? '';
		description = project?.description ?? '';
		sourceUrl = project?.sourceUrl ?? '';
		status = project?.status ?? 'planning';
		submitted = false;
		suggested = null;
	});

	const errors = $derived({
		title: requiredText(title),
		sourceUrl: optionalUrl(sourceUrl)
	});
	const portalLink = $derived(isModelPortalUrl(sourceUrl));
	const suggestion = $derived(suggested?.url === sourceUrl.trim() ? suggested.title : null);

	/**
	 * Asks the page for its own title.
	 *
	 * The same command also returns the preview image, which is deliberately
	 * dropped here: on a new project there is no id to store it under yet, and the
	 * preview card below owns that decision anyway.
	 */
	async function fetchTitle() {
		const url = sourceUrl.trim();
		if (!url || titleBusy || !portalLink || !online.enabled) return;

		titleBusy = true;
		try {
			const fetched = await fetchModelPreview(url);
			const found = fetched.title?.trim();
			if (found) {
				suggested = { url, title: found };
			} else {
				toasts.error('portal.title.none');
			}
		} catch (error) {
			const reason = commandError(error);
			if (reason) {
				toasts.error('portal.title.failed', { reason });
			} else {
				toasts.error('portal.title.failedGeneric');
			}
		} finally {
			titleBusy = false;
		}
	}

	function applySuggestion() {
		if (!suggestion) return;
		title = suggestion;
		suggested = null;
	}
	const shown = $derived(
		submitted ? errors : ({} as Partial<Record<keyof typeof errors, string | null>>)
	);

	async function save() {
		submitted = true;
		if (!isValid(errors) || busy) return;

		busy = true;
		try {
			const payload: Project = {
				id: project?.id,
				title,
				description,
				sourceUrl,
				status,
				createdAt: project?.createdAt ?? '',
				updatedAt: project?.updatedAt ?? ''
			};

			if (payload.id) {
				await updateProject(payload);
				toasts.success('toast.updated');
				onSaved(payload.id);
			} else {
				const id = await createProject(payload);
				toasts.success('toast.created');
				onSaved(id);
			}
			onClose();
		} catch {
			toasts.error('errors.saveFailed');
		} finally {
			busy = false;
		}
	}
</script>

<Modal
	{open}
	title={project ? $t('projects.edit') : $t('projects.add')}
	subtitle={$t('projects.subtitle')}
	{onClose}
>
	<form
		class="grid gap-5"
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		<Field label={$t('projects.fields.title')} error={shown.title}>
			<input
				class="input-base"
				bind:value={title}
				placeholder={$t('projects.fields.titlePlaceholder')}
				data-autofocus
			/>
		</Field>

		<Field label={$t('projects.fields.description')} optional>
			<textarea
				class="input-base min-h-24 resize-y"
				bind:value={description}
				placeholder={$t('projects.fields.descriptionPlaceholder')}
			></textarea>
		</Field>

		<div class="grid gap-3">
			<Field label={$t('projects.fields.sourceUrl')} error={shown.sourceUrl} optional>
				<input
					class="input-base"
					bind:value={sourceUrl}
					placeholder={$t('projects.fields.sourceUrlPlaceholder')}
					spellcheck="false"
				/>
			</Field>

			<!--
				Outside the Field, not inside: Field wraps its children in a <label>,
				and a button in a label would toggle the input's focus on every click.
			-->
			{#if portalLink}
				{#if online.enabled}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
						<Button variant="secondary" size="sm" onclick={fetchTitle} disabled={titleBusy || busy}>
							{#if titleBusy}
								<Loader size={14} class="animate-spin" />
							{:else}
								<CloudDownload size={14} />
							{/if}
							{titleBusy ? $t('portal.title.busy') : $t('portal.title.fetch')}
						</Button>
						<p class="text-xs leading-relaxed text-zinc-400">{$t('portal.title.hint')}</p>
					</div>

					{#if suggestion}
						<div class="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5">
							<p class="text-xs leading-relaxed text-zinc-200">
								{$t('portal.title.suggestion', { values: { title: suggestion } })}
							</p>
							<div class="mt-2 flex flex-wrap gap-2">
								<Button variant="primary" size="sm" onclick={applySuggestion} disabled={busy}>
									{$t('portal.title.apply')}
								</Button>
								<Button variant="ghost" size="sm" onclick={() => (suggested = null)}>
									{$t('portal.title.dismiss')}
								</Button>
							</div>
						</div>
					{/if}
				{:else}
					<p class="text-xs leading-relaxed text-zinc-400">
						{$t('portal.title.offline')}
						<a
							href="/settings"
							class="text-indigo-300 underline underline-offset-2 transition-colors hover:text-indigo-200"
						>
							{$t('portal.offline.settings')}
						</a>
					</p>
				{/if}
			{/if}
		</div>

		<!--
			Only for a project that already exists: the preview is stored against a
			project id, and a project being created has none yet.
		-->
		{#if project?.id}
			<ProjectPreview projectId={project.id} {sourceUrl} variant="inline" />
		{/if}

		<Field label={$t('projects.fields.status')}>
			<select class="input-base" bind:value={status}>
				{#each PROJECT_STATUSES as value (value)}
					<option {value}>{$t(`status.${value}`)}</option>
				{/each}
			</select>
		</Field>

		<button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
	</form>

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		<Button variant="primary" onclick={save} disabled={busy}>
			{busy ? $t('common.saving') : $t('common.save')}
		</Button>
	{/snippet}
</Modal>
