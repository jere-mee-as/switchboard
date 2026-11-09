# switchboard

Switchboard is a separate Android launcher concept, unrelated to JRL Launcher's look: the home screen is laid out like a chat app (Discord-like), with spaces and channels instead of pages and folders. Apps, notifications, events and contacts appear as messages and members.

| File | What |
|---|---|
| `index.html` | The page: v0.2. In a browser it runs on example data; in the app it runs on the phone through `window.SBNative` |
| `android/` | The Android app (`ing.jere.switchboard`): its own HOME app, separate from JRL in every way. See its README |

## How to open

Open `index.html` in a browser. Fonts load from Google Fonts. All data is example data; nothing is read from a phone.

APK: GitHub → Actions → **Switchboard APK** → Run workflow, then download the `switchboard-apk` artifact. The build copies `index.html` into the app, so this file is the only copy of the page.

## Status

Page v0.2, Android app 0.1.0 (first build; never run on a phone yet).

## Docs

[`docs/`](docs/): `switchboard-launcher-plan.md`.
