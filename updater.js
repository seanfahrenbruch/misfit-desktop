// Self-updater. macOS's built-in updater needs a paid Developer ID signature,
// so this one does the same job by hand: it checks the latest GitHub release,
// downloads the zip, and swaps the app bundle in place after the app quits.
// A file we download ourselves isn't quarantined, so no Gatekeeper prompt.
const { app, dialog, net } = require("electron");
const { execFile, spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const fs = require("fs");
const os = require("os");
const path = require("path");

const FEED = process.env.MISFIT_UPDATE_FEED || "https://api.github.com/repos/seanfahrenbruch/misfit-desktop/releases/latest";
const ASSET = "Misfit-Creatives-mac.zip";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let staged = null; // { appPath, version }
let busy = false;
let installing = false;
let log = () => {};

function newer(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, (err) => (err ? reject(err) : resolve())));
}

function installedBundle() {
  // …/Misfit Creatives.app/Contents/MacOS/Misfit Creatives → …/Misfit Creatives.app
  return path.resolve(app.getPath("exe"), "..", "..", "..");
}

async function download(url, dest) {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

async function stage(version, url) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "misfit-update-"));
  const zip = path.join(dir, ASSET);
  await download(url, zip);
  await run("ditto", ["-x", "-k", zip, dir]);
  fs.rmSync(zip, { force: true });
  const appName = fs.readdirSync(dir).find((n) => n.endsWith(".app"));
  if (!appName) throw new Error("no app in update");
  const appPath = path.join(dir, appName);
  if (!fs.existsSync(path.join(appPath, "Contents", "MacOS"))) throw new Error("update looks incomplete");
  await run("xattr", ["-cr", appPath]).catch(() => {});
  staged = { appPath, version };
}

// Waits for this process to exit, swaps the bundle, optionally relaunches.
function spawnInstaller(relaunch) {
  if (!staged || installing) return;
  installing = true;
  const target = installedBundle();
  // Keep the old app until the new one is in place: if anything fails, the old one is put back, so a failed
  // update can never leave the person with no app at all.
  const script = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done; BAK="$TARGET.old"; rm -rf "$BAK"; if mv "$TARGET" "$BAK"; then if mv "$SRC" "$TARGET"; then rm -rf "$BAK"; else rm -rf "$TARGET"; mv "$BAK" "$TARGET"; fi; fi; ${
    relaunch ? 'open "$TARGET"' : "true"
  }`;
  spawn("/bin/sh", ["-c", script], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, TARGET: target, SRC: staged.appPath },
  }).unref();
}

async function check({ manual = false, win = null } = {}) {
  if (busy || installing) return;
  if (!app.isPackaged && !process.env.MISFIT_UPDATE_FEED) return;
  busy = true;
  try {
    if (!staged) {
      const res = await net.fetch(FEED, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) throw new Error(`feed ${res.status}`);
      const release = await res.json();
      const asset = (release.assets || []).find((a) => a.name === ASSET);
      if (!asset || !newer(release.tag_name, app.getVersion())) {
        log("update: up to date", app.getVersion());
        if (manual) await dialog.showMessageBox(win, { type: "info", message: "You're up to date.", detail: `Misfit Creatives ${app.getVersion()}` });
        return;
      }
      const target = installedBundle();
      fs.accessSync(path.dirname(target), fs.constants.W_OK);
      log("update: downloading", release.tag_name);
      await stage(release.tag_name.replace(/^v/, ""), asset.browser_download_url);
      log("update: staged", staged.version);
    }
    if (process.env.MISFIT_UPDATE_AUTO) {
      spawnInstaller(true);
      app.quit();
      return;
    }
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      message: `Misfit Creatives ${staged.version} is ready`,
      detail: "Restart to finish updating. If you choose Later, it installs the next time you quit.",
    });
    if (response === 0) {
      spawnInstaller(true);
      app.quit();
    }
  } catch (err) {
    log("update: failed:", String(err));
    if (manual) await dialog.showMessageBox(win, { type: "warning", message: "Couldn't check for updates.", detail: String(err.message || err) });
  } finally {
    busy = false;
  }
}

function init({ logger, getWindow }) {
  log = logger;
  // A staged update that was postponed is applied when the app next quits.
  app.on("before-quit", () => spawnInstaller(false));
  setTimeout(() => check({ win: getWindow() }), 20000);
  setInterval(() => check({ win: getWindow() }), CHECK_EVERY_MS);
}

module.exports = { init, check };
