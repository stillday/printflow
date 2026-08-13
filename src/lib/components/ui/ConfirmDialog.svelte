<script lang="ts">
	import { t } from 'svelte-i18n';
	import { TriangleAlert } from '@lucide/svelte';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';

	interface Props {
		open: boolean;
		title: string;
		body: string;
		confirmLabel?: string;
		tone?: 'danger' | 'primary';
		onConfirm: () => void | Promise<void>;
		onCancel: () => void;
	}

	// Plain prop, like in `Modal` — the caller closes via `onConfirm`/`onCancel`.
	let {
		open,
		title,
		body,
		confirmLabel,
		tone = 'danger',
		onConfirm,
		onCancel
	}: Props = $props();

	let busy = $state(false);

	async function confirm() {
		if (busy) return;
		busy = true;
		try {
			await onConfirm();
		} finally {
			busy = false;
		}
	}
</script>

<Modal {open} {title} size="sm" onClose={onCancel}>
	<div class="flex gap-4">
		<div
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border {tone ===
			'danger'
				? 'border-rose-500/20 bg-rose-500/10 text-rose-400'
				: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300'}"
		>
			<TriangleAlert size={18} />
		</div>
		<p class="pt-1 text-sm leading-relaxed text-zinc-400">{body}</p>
	</div>

	{#snippet footer()}
		<!--
			Cancel takes the focus, not the confirming button. This dialog guards
			deletions and the backup import, which replaces the whole database — a
			stray Enter right after it opens must not be enough to go through with it.
		-->
		<Button variant="ghost" onclick={onCancel} disabled={busy} data-autofocus>
			{$t('common.cancel')}
		</Button>
		<Button variant={tone === 'danger' ? 'danger' : 'primary'} onclick={confirm} disabled={busy}>
			{confirmLabel ?? $t('common.delete')}
		</Button>
	{/snippet}
</Modal>
