const { app, BrowserWindow, Notification, ipcMain, shell, Menu, Tray, net, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const updater = require("./updater");

const LOG = path.join(app.getPath("userData"), "desktop.log");
function log(...parts) {
  try {
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${parts.join(" ")}\n`);
  } catch {}
}

const PORTAL = "https://portal.misfitcreatives.site";
const ICON = path.join(__dirname, "icon.png");

let win = null;
let quitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Misfit Creatives",
    icon: ICON,
    backgroundColor: "#0042ff",
    // No native title bar: the portal's blue header runs to the top edge and the
    // traffic-light buttons sit on top of it.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 24 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Let Chromium throttle the page while the window is hidden. Alerts still
      // arrive: the Realtime socket stays open and the portal polls as a backup.
      backgroundThrottling: true,
    },
  });
  win.loadURL(PORTAL);
  win.webContents.on("console-message", (_e, _level, message) => {
    if (typeof message === "string" && message.startsWith("[desktop-alerts]")) log(message);
  });

  // Desktop-only tweaks injected here so the shared web portal stays untouched:
  // leave room for the window buttons, and make the header drag the window.
  win.webContents.on("did-finish-load", () => {
    win.webContents.insertCSS(`
      header[class*="0042ff"] { padding-left: 88px !important; -webkit-app-region: drag; }
      header[class*="0042ff"] a, header[class*="0042ff"] button, header[class*="0042ff"] input { -webkit-app-region: no-drag; }
      body:not(:has(header))::before { content: ""; position: fixed; top: 0; left: 0; right: 0; height: 28px; -webkit-app-region: drag; z-index: 40; }
    `);
  });

  // Links to other sites open in the normal browser; the portal stays in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(PORTAL)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(PORTAL) && !url.startsWith("https://txzzuflocnjypdbcvjox.supabase.co")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Closing the window hides it; the app keeps running so alerts still arrive.
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

function showWindow(url) {
  if (!win) createWindow();
  win.show();
  win.focus();
  if (url) win.loadURL(new URL(url, PORTAL).href);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("activate", () => showWindow());

  app.whenReady().then(() => {
    // Packaged builds use the bundle icon so macOS can switch it for light/dark/tinted.
    if (process.platform === "darwin" && !app.isPackaged) app.dock.setIcon(ICON);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        {
          label: "View",
          submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }],
        },
        { role: "windowMenu" },
        { label: "Help", submenu: [{ label: "Check for Updates…", click: () => updater.check({ manual: true, win }) }] },
      ]),
    );
    createWindow();
    updater.init({ logger: log, getWindow: () => win });
    // First launch only: sending one notification makes macOS show its
    // "Allow notifications?" prompt and lists the app in System Settings.
    const firstRun = path.join(app.getPath("userData"), ".notified");
    if (!fs.existsSync(firstRun)) {
      const hello = new Notification({
        title: "Misfit Creatives",
        body: "You'll get alerts here for mentions, comments, and approvals.",
      });
      hello.on("show", () => log("first-run notification shown"));
      hello.on("failed", (_e, err) => log("first-run notification failed:", String(err)));
      hello.show();
      try {
        fs.writeFileSync(firstRun, "1");
      } catch {}
    }
  });

  // Dock badge + menu-bar icon: unread count and the latest unread items.
  let tray = null;
  ipcMain.on("unread", (_event, state) => {
    const count = Math.max(0, Number(state && state.count) || 0);
    const items = Array.isArray(state && state.items) ? state.items.slice(0, 8) : [];
    if (process.platform === "darwin") app.dock.setBadge(count > 0 ? String(count) : "");
    if (!tray) {
      tray = new Tray(path.join(__dirname, "trayTemplate.png"));
      tray.setToolTip("Misfit Creatives");
    }
    tray.setTitle(count > 0 ? ` ${count}` : "");
    const clip = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: count > 0 ? `${count} unread` : "You're all caught up", enabled: false },
        ...(items.length ? [{ type: "separator" }] : []),
        ...items.map((i) => ({ label: `${clip(i.title, 38)} — ${clip(i.body, 34)}`, click: () => showWindow("/inbox") })),
        { type: "separator" },
        { label: "Open Inbox", click: () => showWindow("/inbox") },
        { label: "Open Misfit Creatives", click: () => showWindow() },
        { type: "separator" },
        { label: "Quit", role: "quit" },
      ]),
    );
  });

  // Right-hand notification image = the workspace icon the portal sends (if any).
  async function fetchIcon(url) {
    if (typeof url !== "string" || !/^https:\/\//.test(url)) return undefined;
    try {
      const res = await Promise.race([
        net.fetch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
      ]);
      if (!res.ok) {
        log("icon fetch status:", String(res.status));
        return undefined;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const img = nativeImage.createFromBuffer(buf);
      log("icon fetched:", String(buf.length), "bytes, empty:", String(img.isEmpty()));
      if (img.isEmpty()) return undefined;
      // Saved as a PNG file: macOS attaches notification images from disk.
      const file = path.join(app.getPath("temp"), `misfit-icon-${Date.now()}.png`);
      fs.writeFileSync(file, img.resize({ width: 128, height: 128 }).toPNG());
      return file;
    } catch (err) {
      log("icon fetch failed:", String(err));
      return undefined;
    }
  }

  ipcMain.on("notify", async (_event, alert) => {
    if (!alert || typeof alert.title !== "string") return;
    log("notify received:", alert.title);
    const icon = await fetchIcon(alert.icon);
    const n = new Notification({ title: alert.title, body: String(alert.body || ""), ...(icon ? { icon } : {}) });
    n.on("show", () => log("notify shown", icon ? "(with workspace icon)" : "(no icon)"));
    n.on("failed", (_e, err) => log("notify failed:", String(err)));
    n.on("click", () => showWindow(typeof alert.url === "string" ? alert.url : "/"));
    n.show();
  });
}
