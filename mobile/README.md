# nit — Android shell

A Capacitor 8 shell over the live web app at <https://bongdo.space/nit/>. The WebView
loads that remote URL directly (`server.url`), so there is no bundled web build and no
`web/` build step here. `www/` only holds a small offline page that Capacitor falls back
to if the native runtime ever serves local content.

## Prerequisites

- JDK 21 (Capacitor 8, `compileSdk`/`targetSdk` 36)
- Android SDK Platform 36 + build-tools (Capacitor 8 sets compileSdk/targetSdk 36)
- Google's Linux SDK/build tools are x86_64 only, so an aarch64 host cannot run
  `gradlew` without x86_64 emulation. Everything up to `cap sync` works on any arch.

## Commands

```bash
npm install
npx cap sync android          # or: npm run sync
cd android && ./gradlew assembleDebug
```

From the repository root, `bin/android` does the same and can push (`--install`) or
publish (`--drop`, slug `nit-shell-apk`) the result.

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run open` opens the project in Android Studio.

## Notes

- Icons and splash screens are generated from `assets/` with
  `npx @capacitor/assets generate --android --iconBackgroundColor '#16171b' --splashBackgroundColor '#16171b'`.
- The web app does not need a native build: the bridge injects `window.Capacitor` and
  `Capacitor.Plugins.<Name>` (App, Haptics, StatusBar, SplashScreen) into the remote page,
  so web-side code calls plugins through them.

## Trying the selection menu without a phone

The custom selection menu only arms itself on Android (`nativeAndroid()`). In a desktop
browser open the app with `?touchselect=1` and DevTools touch emulation: long-press a
message picks a word, dragging the finger extends it, the round handles extend it further.
