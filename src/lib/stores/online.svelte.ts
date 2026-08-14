import { SETTING_ONLINE, getSetting, setSetting } from '$lib/db/settings';

/**
 * Whether the app may contact model portals.
 *
 * **On unless switched off.** It unlocks exactly two things — fetching a
 * project's preview image once, and downloading a file from a link the user
 * supplies — and both run in Rust, so the WebView's Content-Security-Policy
 * stays closed either way: the interface itself never opens a socket.
 *
 * Absent means on, which is why the check below is `!== 'off'` rather than
 * `=== 'on'`: an existing installation that never touched the switch should get
 * the new default too, and a failed read must not silently disable a feature the
 * user is relying on.
 */
class OnlineStore {
	enabled = $state(true);
	/** False until the stored value has been read, so the UI can avoid a flicker. */
	loaded = $state(false);

	async load() {
		try {
			this.enabled = (await getSetting(SETTING_ONLINE)) !== 'off';
		} catch {
			// A read failure keeps the default rather than turning a feature off
			// behind the user's back.
			this.enabled = true;
		} finally {
			this.loaded = true;
		}
	}

	/**
	 * Persist first, then switch. This flag gates network access, so the stored
	 * value and the running one must not disagree: turning it *off* and being told
	 * the save failed, while the in-memory gate had already closed, would leave
	 * `'on'` on disk and quietly re-enable the portal commands on the next launch.
	 */
	async set(enabled: boolean) {
		await setSetting(SETTING_ONLINE, enabled ? 'on' : 'off');
		this.enabled = enabled;
	}
}

export const online = new OnlineStore();
