# Application behavior and architecture

The [README](../README.md) compares the three native/web implementations and describes
the audio generators. Keep behavior consistent across platforms; strings are shared through
the [localization catalog](localization.md).

## Appearance

Open **More → Settings → Appearance** and choose **System**, **Light**, or **Dark**.
System is the default and follows the device's appearance automatically. Explicit choices
take effect immediately and stay saved across app restarts and device reboots, using native
preferences or browser local storage. The web app applies the saved choice before rendering
and keeps open tabs in sync. Clearing app/site data removes the preference; blocked browser
storage shows a warning and keeps the choice only for the current page.
The system-controlled mobile launch screen can briefly use the system appearance before
the app's saved appearance takes over.

## Listening history

Open **More → Listening history** and choose **All time** for a bar per sound showing its
total minutes across all saved sessions, or **Calendar** for daily stacked bars and weekly
navigation. Select a sound in either chart's key to open its daily history, with weekly
navigation. **Back to all sounds** restores the overview's view and week. Both charts use
grayscale and minutes played on the Y axis. Calendar uses dates
in the device's current time zone on the X axis and splits overnight sessions at local
midnight. Switching views preserves the selected week.

History stays in the app's data container (`Application Support/listening-history-v1` on iOS,
`files/listening-history-v1` on Android), or the browser's IndexedDB `listening-history` database.
Each session has a UUID `id`, an immutable `soundId` (`white`, `pink`, `brown`, `waves`, `fan`),
and UTC epoch-millisecond `startedAt`, nullable `endedAt`, and `updatedAt` timestamps. Display
names can change without changing these sound IDs. Native sessions are atomic JSON files;
web sessions are individual database rows, so different tabs cannot overwrite one another.
No history is uploaded. The format keeps individual sessions for a future sync API.

Playback starts, stops, sound switches, and interruptions delimit sessions. Active sessions
checkpoint every 15 seconds while the process runs. After an unexpected exit, an unfinished
session ends at its last saved checkpoint, so downtime is never added (the unsaved tail can
be lost). Playback still works if storage fails; History shows a warning. Clearing app/site
data removes the history; operating-system backups may include the native files.

## Playback log

Open **More → Settings → Playback log** to view the latest 300 playback events and share them as
text (or save a text file on the web). Each event includes a UTC timestamp, sound, and
reason. Labels follow the app language; diagnostic codes and OS error messages retain
their original form. Details are limited to 512 characters per event. The log stays on
the device and is never automatically uploaded. Native log files are excluded from backups.
Storage failures show a warning and do not prevent playback; a few queued events can be
lost if the process is killed before they reach disk.

Android records UI, widget, notification and media commands, focus changes, output
disconnections, task removal, engine failures, and service destruction. On Android 11+
it matches unfinished playback to the system's retained process-exit records, including
package updates, low memory, crashes and ANRs. Older Android, iOS and the web cannot always
recover a cause: an unfinished playback marker is reported with an unknown cause, at the
time it was detected. Web recovery uses Web Locks to avoid confusing a live tab with a
closed one; without that API, only the original events are shown. iOS also records audio
interruptions, route and engine configuration changes, and delivered termination notices;
web logs context state, worklet/media failures, visibility and page exits.

Android logs live to `adb logcat -s NoisePlayback`; iOS uses the `NoisePlayback` Logger
category; the browser console uses the same tag. The persisted native files are
`no_backup/playback-log-v1.json` (Android) and `Application Support/playback-log-v1.json`
(iOS); web uses the `playback-log` IndexedDB database, with bounded localStorage receipts
for page closes whose database writes may be discarded during navigation. Recovery consumes
those receipts so ordinary tab closes retain their known cause. Clear app/site data to remove them.
Google Play auto-updates can interrupt ongoing playback. This diagnostic feature does
not restart playback after an update; reopen the app and press Play.

## Web click analytics

Production pages explicitly initialize `@a2f0/ct-client` with site `nc`, app
`web-app`, and environment `production`. Tracking requires both the production
build and the exact `https://nc.a2f0.net` origin. Native apps, local previews, and
module imports do not initialize it; automated browsers are excluded from collection.
The website overrides GPC while honoring DNT and CT's extension and saved opt-outs.
The public [privacy notice](https://nc.a2f0.net/privacy) describes click metadata,
IP/geolocation, 90-day retention, and opt-out instructions. No sound names, settings,
history, or playback logs are sent. Browser integration tests intercept every CT request.
