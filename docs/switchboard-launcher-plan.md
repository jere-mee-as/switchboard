# Switchboard launcher — plan and status (v0.2, Nov 7, 2026)

A separate project from JRL Launcher: an Android home screen that follows the chat-app layout familiar from Discord mobile (layout and features only: no logo, name, colours or other branding). Target phone: Galaxy Z Fold7 (cover screen and inner screen).

Preview: `../index.html` (v0.2, example data). The native shell isn't built yet.

## Decisions from the layout test (Nov 7)
1. First screen shows, without a tap: next 3 events, pinned apps, now playing. Events go above pinned apps.
2. No text bar at the bottom of Home. #feed is the phone's general access point: commands, Operator, easter eggs. Pressing Home never opens the keyboard. The top bar on every list is the way into #feed: one tap opens #feed with the keyboard up. Search lives in the #feed picker.
3. Notifications split by job: #feed = talking to the phone, Messages = people, Activity = everything else plus the agenda. Each notification lives in one place and counts once.
4. Rail on the left edge, Home on top. A setting can move the rail to the right edge and Home to the bottom.
5. Unfolded inner screen: three panes (rail + list | conversation | optional drawer column). Unfolding mid-conversation keeps the same thread; folding lands where you were working.
6. Default spaces: Finance, Dating, Social, AI, Media, Work (plus All apps). Apps auto-sorted by package name, then Android category.
7. You tab: phone info plus a "passport" card (name, line under name, phone, email, up to 5 links, scannable contact code). Do Not Disturb is a toggle.
8. Tapping an app opens it. Pulling up past the end of the list opens All apps. Swiping down at the top of the list pulls the shade. Right drawer opened by the header button or a swipe that starts mid-screen (the edge is Android Back); a fourth column on the unfolded screen.

## v0.2 measurements (preview data, cover screen ~412×883)
- First app moved from 424px (48% down) to 314px (36%); 10 of 13 pinned apps visible plus 3 events.
- One message shows in 3 places (app row count, space tile lamp, Messages tab), down from 8. Visible badge marks 11, down from 17.
- Badge rules: counts only on the tab bar and app rows; space tiles show a lamp; Spaces tab and Home tile carry no badge.

## Layout
- Rail: Home tile, then space tiles (2×2 icon mosaic or glyph, lamp when something's waiting), + new space, All apps.
- Home list: top bar into #feed (lamp when Operator posted something new), Up next (3 events with "in 50 min" style times), Pinned, New apps, Recent, #notes, "Pull up for all apps".
- Space list: #activity (that space's notifications, a filtered view), Apps, Add or remove apps.
- Tabs: Spaces, Messages, Activity, You. Now-playing strip above the tabs (the only now-playing surface).

## #feed commands
open, search, map, call, text · timer, alarm, remind, reminders, event, brief · note, notes, calc, macro · play, pause, next, prev · flash, dnd, settings, shade, battery · roll, flip, 8ball, mate · pin, unpin, move, space, hide, unhide, mute, unmute, info, uninstall · theme, name, clear, help. Hidden: /whoami (passport card).
- Morning brief posts once a day on first Home after 4am: today's events, waiting conversations, battery.
- /remind 20m … / 5pm … / tomorrow 9am …; Operator posts it in #feed when due (Snooze 10 min). Native side schedules an exact alarm.
- /macro name = step; step (commands or app names), run with /name.
- /mate counts cebadas (Cebar button), lavado at 12.
- Hidden phrases Operator answers: hello/hola, thanks/gracias, who are you, good night/buenas noches (offers DND), ping, xyzzy, bored/surprise me, sudo …, che.

## Phone bridge (window.SBNative)
apps, launch, appInfo, uninstall · notifs (≈48 h history, live flag), notifOpen, notifDismiss, dismissAll, notifReply → bool, notifAction · media, mediaCmd · events(days), openEvent, newEvent · contacts (starred), call, sms, openContact · profile (owner card, first run) · battery, device · perms, askPerm, setHome · setDnd → bool, torch → bool, timer, alarm · remind(id, atMs, text), cancelRemind(id) · web, url, maps, settings(panel), shade, copy, haptic, version.
Native → page: SB.onNative(type, json) with back, home, resume, apps, notifs, media, battery, perms, events, remind.
The activity must declare configChanges screenSize|smallestScreenSize|screenLayout|orientation so the WebView survives fold/unfold.

## Native work still to do
Kotlin shell in its own package (HOME intent filter), WebView with insets padding, NotificationListenerService with 48 h history and RemoteInput replies, MediaSessionManager, CalendarContract, starred contacts, owner profile, DND policy access, torch, AlarmClock intents, exact alarms for /remind, package-change receiver. The JRL Launcher's Android project (`../../launcher/android`) is a good starting point.

## Open questions
- Name "Switchboard": keep or rename.
