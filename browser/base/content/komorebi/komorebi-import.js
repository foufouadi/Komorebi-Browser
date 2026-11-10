/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// One-time import of the user's data from an installed Firefox or Google
// Chrome. It is a copy, nothing stays linked to the source browser.
//
// Chrome goes through ChromeProfileMigrator, which works while the browser
// runs. Firefox cannot: FirefoxProfileMigrator is a startup-only "pave over"
// migrator that copies places.sqlite, logins.json and key4.db over the new
// profile and needs MigrationUtils.profileStartup, which only exists before
// the profile is in use. The only supported way in is to start the browser
// with --migration, so Firefox is imported by restarting once into the stock
// migration wizard.

(function (global) {
  "use strict";

  const CHROME_KEY = "chrome";
  const POWERSHELL_PATH = ["System32", "WindowsPowerShell", "v1.0", "powershell.exe"];

  const lazy = {};
  ChromeUtils.defineESModuleGetters(lazy, {
    ChromeMigrationUtils:
      "resource:///modules/ChromeMigrationUtils.sys.mjs",
    MigrationUtils: "resource:///modules/MigrationUtils.sys.mjs",
  });

  function newFile(path) {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    return file;
  }

  async function modifiedTime(path) {
    try {
      return (await IOUtils.stat(path)).lastModified;
    } catch {
      return 0;
    }
  }

  // Windows keeps these files open (and deletes them on close) while the
  // browser runs, so their presence means the data may be locked or stale.
  async function isLocked(directory, leafName) {
    return IOUtils.exists(PathUtils.join(directory, leafName)).catch(() => false);
  }

  async function detectChrome() {
    const migrator = await lazy.MigrationUtils.getMigrator(CHROME_KEY);
    if (!migrator) {
      return null;
    }
    const profiles = (await migrator.getSourceProfiles()) || [];
    if (!profiles.length) {
      return null;
    }
    let defaultId = null;
    try {
      defaultId = await lazy.ChromeMigrationUtils.getLastUsedProfileId();
    } catch {}
    const dataPath = await lazy.ChromeMigrationUtils.getDataPath("Chrome");
    return {
      defaultId: profiles.some(profile => profile.id === defaultId)
        ? defaultId
        : profiles[0].id,
      profiles,
      running: await isLocked(dataPath, "lockfile"),
    };
  }

  async function detectFirefox() {
    const service = Cc["@mozilla.org/toolkit/profile-service;1"].getService(
      Ci.nsIToolkitProfileService
    );
    const current = Services.dirsvc.get("ProfD", Ci.nsIFile);
    const candidates = [];
    for (const profile of service.profiles) {
      const root = profile.rootDir;
      if (!root.exists() || !root.isReadable() || root.equals(current)) {
        continue;
      }
      const used = Math.max(
        await modifiedTime(PathUtils.join(root.path, "places.sqlite")),
        await modifiedTime(PathUtils.join(root.path, "logins.json"))
      );
      // A profile that never held anything has nothing to bring over.
      if (used) {
        candidates.push({ id: root.path, name: profile.name, used });
      }
    }
    if (!candidates.length) {
      return null;
    }
    candidates.sort((a, b) => b.used - a.used);
    const preferred =
      candidates.find(profile => /default-release/.test(profile.id)) ||
      candidates[0];
    return {
      defaultId: preferred.id,
      profiles: candidates.map(({ id, name }) => ({ id, name })),
      running: await isLocked(preferred.id, "parent.lock"),
    };
  }

  // Replaceable in tests so they never read real browser profiles.
  const providers = { chrome: detectChrome, firefox: detectFirefox };

  async function detect() {
    const found = {};
    for (const key of Object.keys(providers)) {
      try {
        found[key] = await providers[key]();
      } catch (error) {
        console.error(`Komorebi could not look for ${key}`, error);
        found[key] = null;
      }
    }
    return found;
  }

  async function importFromChrome(profile, onProgress = () => {}) {
    const { MigrationUtils } = lazy;
    const migrator = await MigrationUtils.getMigrator(CHROME_KEY);
    if (!migrator) {
      throw new Error("Chrome is not available");
    }
    const types = MigrationUtils.resourceTypes;
    const wanted =
      types.BOOKMARKS | types.HISTORY | types.PASSWORDS | types.FORMDATA;
    const items = (await migrator.getMigrateData(profile)) & wanted;
    if (!items) {
      throw new Error("Chrome has nothing to import");
    }
    await migrator.migrate(items, false, profile, onProgress);
    return {
      bookmarks: MigrationUtils.getImportedCount("bookmarks"),
      history: MigrationUtils.getImportedCount("history"),
      logins: MigrationUtils.getImportedCount("logins"),
    };
  }

  function encodePowerShell(script) {
    let binary = "";
    for (let index = 0; index < script.length; index++) {
      const code = script.charCodeAt(index);
      binary += String.fromCharCode(code & 0xff, code >> 8);
    }
    return btoa(binary);
  }

  function quoteForPowerShell(value) {
    return `'${value.replaceAll("'", "''")}'`;
  }

  function powerShell() {
    const root = Services.env.get("SystemRoot");
    if (!root) {
      throw new Error("SystemRoot is not set");
    }
    const file = newFile(PathUtils.join(root, ...POWERSHELL_PATH));
    if (!file.exists()) {
      throw new Error("PowerShell is not available");
    }
    return file;
  }

  /**
   * Runs a PowerShell script detached from this process, so it outlives the
   * browser. PowerShell is used because Start-Process hands the arguments to
   * CreateProcess verbatim, which nsIProcess cannot do.
   */
  function runDetachedScript(script) {
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      encodePowerShell(script),
    ];
    const process = Cc["@mozilla.org/process/util;1"].createInstance(
      Ci.nsIProcess
    );
    process.init(powerShell());
    process.startHidden = true;
    process.noShell = true;
    process.runw(false, args, args.length);
  }

  /**
   * The script that starts this browser again, once it has exited, in the
   * stock migration wizard. Exported for tests.
   */
  function relaunchScript() {
    const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile).path;
    const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
    return [
      `Wait-Process -Id ${Services.appinfo.processID} -ErrorAction SilentlyContinue`,
      `Start-Process -FilePath ${quoteForPowerShell(exe)} -ArgumentList ${quoteForPowerShell(`-profile "${profile}" --migration`)}`,
    ].join("; ");
  }

  /**
   * Quits and starts again with --migration, which runs the startup-only
   * Firefox migrator. Returns false, without quitting, when the helper could
   * not be started.
   */
  function restartIntoFirefoxImport({ quit = true } = {}) {
    try {
      runDetachedScript(relaunchScript());
    } catch (error) {
      console.error("Komorebi could not restart into the Firefox import", error);
      return false;
    }
    if (quit) {
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    }
    return true;
  }

  global.KomorebiImport = {
    detect,
    importFromChrome,
    providers,
    relaunchScript,
    restartIntoFirefoxImport,
    runDetachedScript,
  };
})(this);
