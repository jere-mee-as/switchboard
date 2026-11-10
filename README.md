# Switchboard

**Install:** on the phone, download [`switchboard.apk`](https://github.com/jere-mee-as/switchboard/releases/latest/download/switchboard.apk) from the [latest release](https://github.com/jere-mee-as/switchboard/releases/latest), open it, and allow the install. Then Settings → Apps → Switchboard → ⋮ → **Allow restricted settings**, and set it as the home app. Try it without a phone: [jere.ing/#lab](https://jere.ing/#lab).

Switchboard is a separate Android launcher concept, unrelated to JRL Launcher's look: the home screen is laid out like a chat app (Discord-like), with spaces and channels instead of pages and folders. Apps, notifications, events and contacts appear as messages and members.

| File | What |
|---|---|
| `index.html` | The page: v0.4. In a browser it runs on example data; in the app it runs on the phone through `window.SBNative` |
| `android/` | The Android app (`ing.jere.switchboard`): its own HOME app, separate from JRL in every way. See its README |

## How to open

Open `index.html` in a browser. Fonts load from Google Fonts. All data is example data; nothing is read from a phone.

Release: Actions → **Release APK** → **Run workflow** builds the APK and publishes it as release `v<versionName>` (the button is the only trigger). The build copies `index.html` into the app, so this file is the only copy of the page.

## Status

Page v0.4, Android app 0.3.0. **Updates:** type `/update` in #feed (or You → Launcher → Check for updates). It installs the latest release over the old app (Android asks you to confirm) and pulls the newest page from `main`, which shows with no install at all; the app also fetches a newer page by itself every few hours and switches next time you come home. A downloaded page that fails to start is thrown away automatically (`/update reset` does it by hand). Releases are signed with the permanent key in the `SB_KEYSTORE_*` secrets (backup: Proton Drive `Claude Things/Setup/keys/`). Gestures: pull down past the top of any list for #feed, pull up past the end of Home or a space for All apps, pull up past the newest message to go back, pull down on the rail for the notification shade. Hold a space and drag it to reorder.

## Docs

[`docs/`](docs/): `switchboard-launcher-plan.md`.
