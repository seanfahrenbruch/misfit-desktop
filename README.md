# Misfit Creatives — Mac app

A small desktop wrapper around the Misfit Creatives client portal (https://portal.misfitcreatives.site).
It loads the live portal in its own window and shows native macOS notifications.

Download the latest build from the Releases page. The app isn't notarized yet, so the first time
you open it: right-click the app → Open → Open (or System Settings → Privacy & Security → Open Anyway).

Build: `npm install && npm run build` (output in `.dist/`).

Release assets (both are needed): `Misfit-Creatives-mac.dmg` is what people download (drag-to-Applications
window, built with `pip install dmgbuild && npm run dmg`); `Misfit-Creatives-mac.zip` is what the in-app
updater downloads. Upload both to every release.
