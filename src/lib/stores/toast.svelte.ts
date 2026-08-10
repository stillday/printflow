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

	push(key: string, variant: ToastVariant = 'success', values?: Record<string, string | number>) {
		const id = this.#nextId++;
		this.items = [...this.items, { id, key, values, variant }];
		setTimeout(() => this.dismiss(id), DISMISS_AFTER_MS);
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
