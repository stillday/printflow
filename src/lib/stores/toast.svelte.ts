export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
	id: number;
	/** i18n key — toasts never carry pre-translated prose. */
	key: string;
	values?: Record<string, string | number>;
	variant: ToastVariant;
}

const DISMISS_AFTER_MS = 3600;

class ToastStore {
	items = $state<Toast[]>([]);
	#nextId = 1;

	/**
	 * Errors stay until dismissed; confirmations fade.
	 *
	 * A toast is the app's only report of a failure, and several of them carry the
	 * reason ("could not scan the folder: …"). Three and a half seconds is not
	 * enough to read that, let alone act on it — while a "Saved" that lingers is
	 * just noise.
	 */
	push(key: string, variant: ToastVariant = 'success', values?: Record<string, string | number>) {
		const id = this.#nextId++;
		this.items = [...this.items, { id, key, values, variant }];
		if (variant !== 'error') {
			setTimeout(() => this.dismiss(id), DISMISS_AFTER_MS);
		}
	}

	success(key: string, values?: Record<string, string | number>) {
		this.push(key, 'success', values);
	}

	error(key: string, values?: Record<string, string | number>) {
		this.push(key, 'error', values);
	}

	dismiss(id: number) {
		this.items = this.items.filter((toast) => toast.id !== id);
	}
}

export const toasts = new ToastStore();
