<script lang="ts">
	import { t } from 'svelte-i18n';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import { createProject, updateProject } from '$lib/db/projects';
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

	$effect(() => {
		if (!open) return;
		title = project?.title ?? '';
		description = project?.description ?? '';
		sourceUrl = project?.sourceUrl ?? '';
		status = project?.status ?? 'planning';
		submitted = false;
	});

	const errors = $derived({
		title: requiredText(title),
		sourceUrl: optionalUrl(sourceUrl)
	});
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

		<Field label={$t('projects.fields.sourceUrl')} error={shown.sourceUrl} optional>
			<input
				class="input-base"
				bind:value={sourceUrl}
				placeholder={$t('projects.fields.sourceUrlPlaceholder')}
				spellcheck="false"
			/>
		</Field>

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
