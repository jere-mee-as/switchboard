# Switchboard

**Install:** on the phone, download [`switchboard.apk`](https://github.com/jere-mee-as/switchboard/releases/latest/download/switchboard.apk) from the [latest release](https://github.com/jere-mee-as/switchboard/releases/latest), open it, and allow the install. Then Settings → Apps → Switchboard → ⋮ → **Allow restricted settings**, and set it as the home app. Try it without a phone: [jere.ing/#lab](https://jere.ing/#lab).

Switchboard is an Android launcher, separate from JRL Launcher in every way. Page 1.0 is **One bar**: one still home screen (today, sixteen apps, the bar) that never scrolls.

- **Tap the bar** to type to your phone: apps, favorite people, spaces, notes, sums, the web, Maps, and `.` commands (a period; a slash still works). With nothing typed it shows every app A–Z.
- **Swipe sideways** for the next space; each space is a page with what's waiting from its apps. One swipe right of Home is **Recent**: the apps you opened lately, plus Settings, My Files, Wi-Fi, Bluetooth, Flashlight and Do Not Disturb. **Hold the dots** and slide along them to jump to any page.
- **Pull up** for everything waiting: people first (reply from the bar), then everything else by app, then timers and reminders.
- **Pull down** for the notification shade. **Tap the cover** in the bar for the album-art player.
- **Hold an app** for its options; hold and drag to reorder.
- Unfolded, what's waiting sits beside home.

| File | What |
|---|---|
| `index.html` | The page (One bar 1.0), built from `src/`. In a browser it runs on example data; in the app it runs on the phone through `window.SBNative` |
| `src/` | One bar's own code (`ob.css`, `body.html`, `ob.js`) and `assemble.py`, which adds the pieces carried over from v0.4: `cd src && python3 assemble.py ../docs/archive/index-v0.4.html ../index.html`. `bridge-check.js ../index.html` drives the page against a strict fake of the phone bridge (argument counts from the Kotlin source, `arity.json`) |
| `docs/archive/index-v0.4.html` | The previous page: the Discord-like layout (rail, channels, tabs) |
| `android/` | The Android app (`ing.jere.switchboard`). See its README |

## How to open

Open `index.html` in a browser. Fonts load from Google Fonts. All data is example data; nothing is read from a phone.

Release: Actions → **Release APK** → **Run workflow** builds the APK and publishes it as release `v<versionName>` (the button is the only trigger). The build copies `index.html` into the app, so this file is the only copy of the page.

## Status

Page One bar 1.1, Android app 0.3.0. One bar uses the same bridge and the same saved data as v0.4 (spaces, pins, passport, notes, reminders), so no new APK is needed. **Updates:** type `.update` in the bar (or You → Check for updates). It installs the latest release over the old app (Android asks you to confirm) and pulls the newest page from `main`, which shows with no install at all; the app also fetches a newer page by itself every few hours and switches next time you come home. A downloaded page that fails to start is thrown away automatically; `.update reset` goes back to the page built into the app. Releases are signed with the permanent key in the `SB_KEYSTORE_B64` secret (backup: Proton Drive `Claude Things/Setup/keys/`).

## Docs

[`docs/`](docs/): `switchboard-launcher-plan.md`.
