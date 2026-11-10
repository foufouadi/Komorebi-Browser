/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* globals gNotificationBox */

// The Firefox updater is disabled at build time (--disable-updater), so
// Komorebi updates itself from its GitHub releases: it looks for a newer
// release, downloads the installer, checks its SHA-256 against the checksum
// published next to it, then hands over to the installer, which waits for
// this browser to exit, installs over the same folder and starts it again.

(function (global) {
  "use strict";

  // The release workflow rewrites this line from its version input before
  // compiling. It is the only place the version is written.
  const KOMOREBI_VERSION = "0.1.0";

  const RELEASES_API =
    "https://api.github.com/repos/foufouadi/Komorebi-Browser/releases/latest";
  const INSTALLER_ASSET = "Komorebi-Browser-Setup.exe";
  const CHECKSUM_ASSET = `${INSTALLER_ASSET}.sha256`;
  const PREFS = "browser.komorebi.update.";
  const AUTO_CHECK_PREF = `${PREFS}autoCheck`;
  const LAST_CHECK_PREF = `${PREFS}lastCheck`;
  const LAST_ATTEMPT_PREF = `${PREFS}lastAttempt`;
  const LATEST_PREF = `${PREFS}latest`;
  const DISMISSED_PREF = `${PREFS}dismissed`;
  // Test switches. A build run from the object directory never offers
  // updates, since installing over it would replace the developer's build.
  const ALLOW_DEV_PREF = `${PREFS}allowDev`;
  const TEST_VERSION_PREF = `${PREFS}testVersion`;
  const API_URL_PREF = `${PREFS}apiUrl`;
  const NOTIFICATION_ID = "komorebi-update";
  const STARTUP_DELAY_MS = 45000;
  const CHECK_INTERVAL_S = 24 * 60 * 60;
  const RETRY_INTERVAL_S = 10 * 60;
  const REQUEST_TIMEOUT_MS = 20000;
  const STALL_TIMEOUT_MS = 30000;
  const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
  const WRITE_BUFFER_BYTES = 4 * 1024 * 1024;
  const TRUSTED_HOSTS = /(?:^|\.)(?:github\.com|githubusercontent\.com)$/;
  const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

  const listeners = new Set();
  let state = { phase: "idle", progress: 0 };
  let busy = false;

  function parseVersion(text) {
    const match = SEMVER.exec(String(text ?? "").trim());
    if (!match) {
      return null;
    }
    return {
      numbers: match.slice(1, 4).map(Number),
      prerelease: match[4] ? match[4].split(".") : [],
    };
  }

  function comparePrerelease(a, b) {
    if (!a.length || !b.length) {
      // A release ranks above any of its prereleases.
      return a.length === b.length ? 0 : a.length ? -1 : 1;
    }
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      if (a[index] === undefined || b[index] === undefined) {
        return a[index] === undefined ? -1 : 1;
      }
      const numeric = /^\d+$/.test(a[index]) && /^\d+$/.test(b[index]);
      const order = numeric
        ? Number(a[index]) - Number(b[index])
        : a[index].localeCompare(b[index]);
      if (order) {
        return Math.sign(order);
      }
    }
    return 0;
  }

  /** Negative when `a` is older than `b`; null when either is not semver. */
  function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    if (!left || !right) {
      return null;
    }
    for (let index = 0; index < 3; index++) {
      if (left.numbers[index] !== right.numbers[index]) {
        return Math.sign(left.numbers[index] - right.numbers[index]);
      }
    }
    return comparePrerelease(left.prerelease, right.prerelease);
  }

  function nowSeconds() {
    return Math.floor(Date.now() / 1000);
  }

  function allowDev() {
    return Services.prefs.getBoolPref(ALLOW_DEV_PREF, false);
  }

  function installFile() {
    return Services.dirsvc.get("XREExeF", Ci.nsIFile);
  }

  function isDevBuild() {
    return installFile().path.toLowerCase().includes("obj-komorebi");
  }

  function updatesEnabled() {
    return !isDevBuild() || allowDev();
  }

  function currentVersion() {
    const override = Services.prefs.getStringPref(TEST_VERSION_PREF, "");
    return allowDev() && parseVersion(override) ? override : KOMOREBI_VERSION;
  }

  function setState(next) {
    state = { progress: 0, ...next };
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (error) {
        console.error("Komorebi update listener failed", error);
      }
    }
  }

  function isTrustedURL(spec) {
    try {
      const uri = Services.io.newURI(spec);
      if (uri.schemeIs("https") && TRUSTED_HOSTS.test(uri.host)) {
        return true;
      }
      // Only for tests that serve a release from this computer.
      return (
        allowDev() &&
        uri.schemeIs("http") &&
        ["localhost", "127.0.0.1"].includes(uri.host)
      );
    } catch {
      return false;
    }
  }

  function apiURL() {
    const override = allowDev() && Services.prefs.getStringPref(API_URL_PREF, "");
    return override || RELEASES_API;
  }

  async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        ...options,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function pickRelease(release) {
    const version = parseVersion(release?.tag_name) && release.tag_name.replace(/^v/, "");
    if (!version) {
      return null;
    }
    const asset = name =>
      release.assets?.find(item => item.name === name)?.browser_download_url;
    return {
      checksumUrl: asset(CHECKSUM_ASSET) ?? null,
      installerUrl: asset(INSTALLER_ASSET) ?? null,
      pageUrl: release.html_url ?? null,
      tag: release.tag_name,
      version,
    };
  }

  function readStoredLatest() {
    try {
      const stored = JSON.parse(Services.prefs.getStringPref(LATEST_PREF, ""));
      return parseVersion(stored?.version) ? stored : null;
    } catch {
      return null;
    }
  }

  function isNewer(release) {
    return Boolean(release) && compareVersions(currentVersion(), release.version) < 0;
  }

  function adoptStoredRelease() {
    const stored = readStoredLatest();
    if (isNewer(stored)) {
      setState({ latest: stored, phase: "available" });
    } else if (state.phase === "idle") {
      setState({ phase: "current" });
    }
  }

  /**
   * Looks for a newer release. Resolves to the new state; failures end in
   * the "error" phase and never throw.
   */
  async function check() {
    if (busy || !updatesEnabled()) {
      return state;
    }
    busy = true;
    setState({ phase: "checking" });
    try {
      const response = await fetchWithTimeout(apiURL(), {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) {
        throw new Error(`Release lookup failed (${response.status})`);
      }
      const release = pickRelease(await response.json());
      Services.prefs.setIntPref(LAST_CHECK_PREF, nowSeconds());
      if (isNewer(release)) {
        Services.prefs.setStringPref(LATEST_PREF, JSON.stringify(release));
        setState({ latest: release, phase: "available" });
      } else {
        Services.prefs.clearUserPref(LATEST_PREF);
        setState({ phase: "current" });
      }
    } catch (error) {
      console.error("Komorebi could not check for updates", error);
      setState({ error: "network", phase: "error" });
    } finally {
      busy = false;
    }
    return state;
  }

  function toHex(binary) {
    return Array.from(binary, character =>
      character.charCodeAt(0).toString(16).padStart(2, "0")
    ).join("");
  }

  async function fetchChecksum(url) {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Checksum download failed (${response.status})`);
    }
    const match = /\b[0-9a-f]{64}\b/i.exec((await response.text()).slice(0, 4096));
    if (!match) {
      throw new Error("The checksum file does not hold a SHA-256 value");
    }
    return match[0].toLowerCase();
  }

  /**
   * Streams the installer to `path` while hashing it, so the file is never
   * read back. Resolves to the SHA-256 in lowercase hex.
   */
  async function download(url, path, onProgress) {
    const controller = new AbortController();
    let stall = null;
    const watch = () => {
      window.clearTimeout(stall);
      stall = window.setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    };
    watch();
    try {
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Installer download failed (${response.status})`);
      }
      const total = Number(response.headers.get("content-length")) || 0;
      if (total > MAX_INSTALLER_BYTES) {
        throw new Error("The installer is larger than expected");
      }
      const hash = Cc["@mozilla.org/security/hash;1"].createInstance(
        Ci.nsICryptoHash
      );
      hash.init(hash.SHA256);
      const reader = response.body.getReader();
      let received = 0;
      let pending = [];
      let pendingBytes = 0;
      let created = false;
      const flush = async () => {
        if (!pendingBytes) {
          return;
        }
        const block = new Uint8Array(pendingBytes);
        let offset = 0;
        for (const part of pending) {
          block.set(part, offset);
          offset += part.length;
        }
        pending = [];
        pendingBytes = 0;
        await IOUtils.write(path, block, {
          mode: created ? "append" : "overwrite",
        });
        created = true;
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        watch();
        received += value.length;
        if (received > MAX_INSTALLER_BYTES) {
          throw new Error("The installer is larger than expected");
        }
        hash.update(value, value.length);
        pending.push(value);
        pendingBytes += value.length;
        if (pendingBytes >= WRITE_BUFFER_BYTES) {
          await flush();
        }
        onProgress(total ? received / total : 0);
      }
      await flush();
      if (!received || (total && received !== total)) {
        throw new Error("The installer download is incomplete");
      }
      return toHex(hash.finish(false));
    } finally {
      window.clearTimeout(stall);
    }
  }

  function quotePowerShell(value) {
    return `'${value.replaceAll("'", "''")}'`;
  }

  // Replaceable in tests, so nothing is installed or closed.
  const hooks = {
    /**
     * The installer is handed the folder this browser runs from as /D=, which
     * NSIS only honours as the last argument and unquoted, so the command
     * line goes through PowerShell, which passes it verbatim.
     */
    launchInstaller(installerPath) {
      const folder = PathUtils.parent(installFile().path);
      global.KomorebiImport.runDetachedScript(
        `Start-Process -FilePath ${quotePowerShell(installerPath)} -ArgumentList ${quotePowerShell(`/S /UPDATE /D=${folder}`)}`
      );
    },
    quit() {
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    },
  };

  async function discard(path) {
    await IOUtils.remove(path, { ignoreAbsent: true }).catch(() => {});
  }

  /**
   * Downloads the latest installer, verifies it and starts it, then quits so
   * the installer can replace the files.
   */
  async function install() {
    const latest = state.latest;
    if (busy || state.phase !== "available" || !updatesEnabled()) {
      return state;
    }
    busy = true;
    let path = null;
    try {
      if (
        !latest?.installerUrl ||
        !latest.checksumUrl ||
        !isTrustedURL(latest.installerUrl) ||
        !isTrustedURL(latest.checksumUrl)
      ) {
        setState({ error: "assets", latest, phase: "error" });
        return state;
      }
      setState({ latest, phase: "downloading" });
      let expected;
      try {
        expected = await fetchChecksum(latest.checksumUrl);
      } catch (error) {
        console.error("Komorebi could not read the update checksum", error);
        setState({ error: "checksum-missing", latest, phase: "error" });
        return state;
      }
      path = PathUtils.join(
        PathUtils.tempDir,
        `Komorebi-Browser-Setup-${latest.version}.exe`
      );
      await discard(path);
      let actual;
      try {
        actual = await download(latest.installerUrl, path, progress =>
          setState({ latest, phase: "downloading", progress })
        );
      } catch (error) {
        console.error("Komorebi could not download the update", error);
        await discard(path);
        setState({ error: "download", latest, phase: "error" });
        return state;
      }
      setState({ latest, phase: "verifying", progress: 1 });
      if (actual !== expected) {
        console.error(`Komorebi update checksum mismatch: ${actual} != ${expected}`);
        await discard(path);
        setState({ error: "checksum", latest, phase: "error" });
        return state;
      }
      setState({ latest, phase: "installing", progress: 1 });
      try {
        hooks.launchInstaller(path);
      } catch (error) {
        console.error("Komorebi could not start the installer", error);
        setState({ error: "launch", latest, phase: "error" });
        return state;
      }
      hooks.quit();
    } finally {
      busy = false;
    }
    return state;
  }

  function dismiss() {
    if (state.latest) {
      Services.prefs.setStringPref(DISMISSED_PREF, state.latest.version);
    }
  }

  async function showNotification() {
    const { latest } = state;
    if (
      !latest ||
      Services.prefs.getStringPref(DISMISSED_PREF, "") === latest.version ||
      gNotificationBox.getNotificationWithValue(NOTIFICATION_ID)
    ) {
      return;
    }
    global.MozXULElement.insertFTLIfNeeded("browser/komorebi.ftl");
    await gNotificationBox.appendNotification(
      NOTIFICATION_ID,
      {
        label: {
          "l10n-id": "komorebi-update-notification",
          "l10n-args": { version: latest.version },
        },
        priority: gNotificationBox.PRIORITY_INFO_LOW,
        eventCallback(event) {
          if (event === "dismissed") {
            dismiss();
          }
        },
      },
      [
        {
          "l10n-id": "komorebi-update-notification-action",
          callback() {
            global.KomorebiLibrary.open("browser");
            return false;
          },
        },
      ]
    );
    document.l10n.translateFragment(gNotificationBox.currentNotification);
  }

  async function startupCheck() {
    if (
      !Services.prefs.getBoolPref(AUTO_CHECK_PREF, true) ||
      !updatesEnabled() ||
      !window.toolbar.visible ||
      window.browsingContext.usePrivateBrowsing
    ) {
      return;
    }
    // A failed check is retried at the next start, but not by every window
    // that opens within minutes of each other.
    const age = nowSeconds() - Services.prefs.getIntPref(LAST_CHECK_PREF, 0);
    const sinceAttempt =
      nowSeconds() - Services.prefs.getIntPref(LAST_ATTEMPT_PREF, 0);
    if ((age >= CHECK_INTERVAL_S || age < 0) && sinceAttempt >= RETRY_INTERVAL_S) {
      Services.prefs.setIntPref(LAST_ATTEMPT_PREF, nowSeconds());
      await check();
    }
    if (state.phase === "available") {
      await showNotification();
    }
  }

  function init() {
    adoptStoredRelease();
    if (!updatesEnabled()) {
      return;
    }
    window.setTimeout(
      () =>
        startupCheck().catch(error =>
          console.error("Komorebi update check failed", error)
        ),
      STARTUP_DELAY_MS
    );
  }

  global.KomorebiUpdate = {
    check,
    compareVersions,
    dismiss,
    getState: () => state,
    hooks,
    init,
    install,
    isDevBuild,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    showNotification,
    updatesEnabled,
    get version() {
      return currentVersion();
    },
  };
})(this);
