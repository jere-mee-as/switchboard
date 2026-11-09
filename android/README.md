# Switchboard (Android app)

Switchboard's home-screen app. Its own app in every way: package `ing.jere.switchboard`, label Switchboard, its own
icon, bridge, workflow and signing secrets. It shares nothing with JRL Launcher.

A thin Kotlin shell: one WebView running `switchboard/index.html` (copied into the APK's assets at build time, so
there is one copy of the page), plus `window.SBNative` for the phone. The WebView sits inside the system bars; the
strips behind the bars take the colour the page painted, so every skin (auto, dark, black, light) looks right.

| | |
|---|---|
| applicationId / package | `ing.jere.switchboard` |
| Version | 0.1.0 (versionCode 1) |
| SDK | min 26, target/compile 35 |
| Toolchain | AGP 8.7.3, Kotlin 2.0.21, Gradle 8.10.2 (wrapper), JDK 17 |

```
app/src/main/java/ing/jere/switchboard/
  MainActivity.kt  WebView, insets, native → page events, launching, permission and home-role dialogs
  Native.kt        window.SBNative: every method the page calls
  Notifs.kt        NotifService (notification access) + the 48 h history behind Messages and Activity
  Reminders.kt     /remind: exact alarms → a notification; rescheduled after a restart
  IconHandler.kt   /icon/<pkg>/<activity>: unmasked square PNGs (the page applies the icon shape)
```

## Build

GitHub → Actions → **Switchboard APK** → Run workflow (manual only). Download the `switchboard-apk` artifact.

Signing uses its own secrets: `SB_KEYSTORE_B64`, `SB_KEYSTORE_PASSWORD`, `SB_KEY_ALIAS`, `SB_KEY_PASSWORD`. Without
them the APK is debug-signed: fine to try, but each CI run then has a new key, so the next build needs an uninstall
first. Android Studio: open this folder, Build → Build APK(s).

## Install

1. Open the APK on the phone; allow installs from that app when asked.
2. Settings → Apps → Switchboard → ⋮ → **Allow restricted settings** (Android 13+ blocks notification access for
   sideloaded apps until you do).
3. Make it the home app: the "set as home" card in the page, or Settings → Apps → Choose default apps → Home app.
4. Allow what the page asks for: notification access (Messages, Activity, replies, now playing), calendar,
   contacts (starred people + your card), Do Not Disturb access (`/dnd`), phone (calls without the dialer).

## Bridge: `window.SBNative`

Matches the "PHONE BRIDGE" block at the top of the page's main script. WebView matches calls by name and argument
count, so each method takes exactly what the page passes. Checked in a browser against a fake bridge that throws on
any wrong count, driving the page and 18 #feed commands: no wrong calls, no errors.

| Method | Returns / does |
|---|---|
| `apps()` | `[{key: "pkg/activity", pkg, label, cat, icon}]`; `cat` from the app's Android category; `icon` = `/icon/…` URL |
| `launch(key)` → bool, `appInfo(pkg)`, `uninstall(pkg)` | |
| `notifs()` | `[{id, pkg, kind, title, text, person, convo, group, time, live, canReply, actions}]`, ~48 h, newest 300, one entry per chat message, the user's own messages skipped; kept on disk |
| `notifOpen(id)`, `notifDismiss(id)`, `dismissAll()`, `notifReply(id, text)` → bool, `notifAction(id, index)` | Act through the notification's own intents while it is in the shade |
| `media()` | `{pkg, title, artist, playing, art}` (art = JPEG data URL or null) or `null` |
| `mediaCmd(cmd)` | play, pause, toggle, next, prev |
| `events(days)` | `[{id, title, start, end, allDay, loc, color}]` (all-day days in local time) |
| `openEvent(id)`, `newEvent(title, startMs, endMs, allDay)` → bool | new events open the calendar app filled in |
| `contacts()` | starred `[{id, name, phone}]` |
| `call(number)`, `sms(number, body)`, `openContact(id)` | calls directly with phone permission, else the dialer |
| `profile()` | `{name, phone, email}` from the phone's own contact card |
| `battery()`, `device()`, `perms()` | `{pct, charging}`, `{model, android, free, total}`, `{notif, calendar, contacts, dnd, phone, alarms, isHome}` |
| `askPerm(name)`, `setHome()` | notif, calendar, contacts, phone, dnd, alarms, home, post |
| `setDnd(on)` → bool, `torch(on)` → bool | |
| `timer(seconds, label)` → bool, `alarm(hour, minute, label)` → bool | handed to the Clock app without opening it |
| `remind(id, atMs, text)` → bool, `cancelRemind(id)` → bool | exact alarm → notification + `remind` event |
| `web(q)`, `url(href)`, `maps(q)`, `settings(panel)`, `shade()`, `copy(text)` → bool, `haptic(kind)`, `version()` | |

Native → page: `window.SB.onNative(type, json)` with `back`, `home`, `resume`, `apps`, `notifs` (re-read),
`media`, `battery`, `perms` (after a permission dialog), `remind`.

## Not done yet

- Never compiled before its first CI run (no Android SDK where it was written; Kotlin syntax-checked only). Release
  lint doesn't block the build. If the first run fails, the log's first `e:` line is the fix.
- `events` push (the page re-reads on every resume instead).
- Fonts load from Google Fonts (online); offline the page falls back to system fonts.
