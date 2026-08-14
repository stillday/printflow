<script lang="ts">
	import { t } from 'svelte-i18n';
	import { FolderKanban, Plus } from '@lucide/svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import { createProject, listProjects } from '$lib/db/projects';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { ProjectWithProgress } from '$lib/types/schema';
	import type { ScannedFile } from '$lib/db/library';
	import { requiredText } from '$lib/utils/validate';
	import { cn } from '$lib/utils/cn';

	interface Props {
		file: ScannedFile | null;
		/** Folder-derived name, pre-filled for the "new project" case. */
		suggestedName: string;
		onClose: () => void;
		onChosen: (projectId: number) => void;
	}

	let { file, suggestedName, onClose, onChosen }: Props = $props();

	type Mode = 'existing' | 'new';

	let mode = $state<Mode>('new');
	let projects = $state<ProjectWithProgress[]>([]);
	let selectedId = $state(0);
	let newTitle = $state('');
	let busy = $state(false);
	let showError = $state(false);
	/** The projects are in; before that the body is not worth rendering. */
	let loaded = $state(false);
	let body = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!file) return;
		newTitle = suggestedName;
		showError = false;
		loaded = false;
		void loadProjects();
	});

	// A file's folder usually *is* the project, so "new" is the common case —
	// unless the library already has projects, where picking is more likely.
	async function loadProjects() {
		try {
			projects = await listProjects();
			if (projects.length > 0) {
				mode = 'existing';
				selectedId = projects[0].id ?? 0;
			} else {
				mode = 'new';
			}
		} catch {
			toasts.error('errors.loadFailed');
		} finally {
			loaded = true;
		}
	}

	// The dialog opens before the projects arrive, so whatever `Modal` autofocused
	// is gone by the time the real body renders. Claim focus back once, or it ends
	// up on <body>, outside the panel and outside its Tab trap.
	$effect(() => {
		if (!loaded || !body) return;
		body.querySelector<HTMLElement>('[data-autofocus]')?.focus();
	});

	const titleError = $derived(mode === 'new' ? requiredText(newTitle) : null);
	const valid = $derived(mode === 'new' ? titleError === null : selectedId > 0);

	async function confirm() {
		if (busy) return;
		if (!valid) {
			showError = true;
			return;
		}
		busy = true;
		try {
			if (mode === 'existing') {
				onChosen(selectedId);
			} else {
				const id = await createProject({
					title: newTitle.trim(),
					description: null,
					sourceUrl: null,
					status: 'planning'
				});
				toasts.success('toast.created');
				onChosen(id);
			}
		} catch {
			toasts.error('errors.saveFailed');
		} finally {
			busy = false;
		}
	}
</script>

<Modal
	open={file !== null}
	title={$t('files.chooseProject')}
	subtitle={file?.fileName}
	size="sm"
	{onClose}
>
	{#if file && loaded}
		<div bind:this={body} class="grid gap-5">
			{#if projects.length > 0}
				<div class="grid grid-cols-2 gap-2">
					{#each [{ value: 'existing', labelKey: 'files.existingProject', icon: FolderKanban }, { value: 'new', labelKey: 'files.newProject', icon: Plus }] as option (option.value)}
						{@const selected = mode === option.value}
						<button
							type="button"
							aria-pressed={selected}
							class={cn(
								'flex items-center gap-2 rounded-xl border px-4 py-3 text-left text-sm transition-colors',
								selected
									? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200'
									: 'border-white/10 bg-zinc-950/40 text-zinc-300 hover:border-white/20 hover:bg-white/5'
							)}
							onclick={() => (mode = option.value as Mode)}
						>
							<option.icon size={15} />
							{$t(option.labelKey)}
						</button>
					{/each}
				</div>
			{/if}

			{#if mode === 'existing'}
				<Field label={$t('files.existingProject')}>
					<select class="input-base" bind:value={selectedId} data-autofocus>
						{#each projects as project (project.id)}
							<option value={project.id}>{project.title}</option>
						{/each}
					</select>
				</Field>
			{:else}
				<Field
					label={$t('projects.fields.title')}
					error={showError ? titleError : null}
					hint={$t('files.newProjectHint')}
				>
					<input
						class="input-base"
						bind:value={newTitle}
						data-autofocus
						onkeydown={(event) => event.key === 'Enter' && confirm()}
					/>
				</Field>
			{/if}
		</div>
	{:else if file}
		<p class="py-2 text-sm text-zinc-400">{$t('common.loading')}</p>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{$t('common.cancel')}</Button>
		<Button variant="primary" onclick={confirm} disabled={busy || !loaded}>
			{$t('common.continue')}
		</Button>
	{/snippet}
</Modal>
