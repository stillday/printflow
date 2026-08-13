import { SETTING_ONLINE, getSetting, setSetting } from '$lib/db/settings';

/**
 * Whether the user has allowed the app to contact model portals.
 *
 * PrintFlow is offline by default and says so on every screen, so this is a
 * deliberate, explicit opt-in rather than a convenience default. Turning it on
 * unlocks exactly two things — fetching a project's preview image once, and
 * downloading a file from a link the user supplies — both of which run in Rust,
 * so the WebView's Content-Security-Policy stays closed either way.
 */
class OnlineStore {
	enabled = $state(false);
	/** False until the stored value has been read, so the UI can avoid a flicker. */
	loaded = $state(false);

	async load() {
		try {
			this.enabled = (await getSetting(SETTING_ONLINE)) === 'on';
		} catch {
			// A read failure keeps the safe default.
			this.enabled = false;
		} finally {
			this.loaded = true;
		}
	}

	async set(enabled: boolean) {
		this.enabled = enabled;
		await setSetting(SETTING_ONLINE, enabled ? 'on' : 'off');
	}
}

export const online = new OnlineStore();
