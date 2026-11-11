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
// Chrome goes through ChromeProfileMigrator. Komorebi keeps its profiles apart
// from Firefox's, so Firefox is read directly: its bookmarks and history are
// taken from copies of its files and the source profile is never written to.
//
// adoptPreviousProfile() brings back the profile that older builds kept in
// Firefox's own folder.

(function (global) {
  "use strict";

  const CHROME_KEY = "chrome";
  const POWERSHELL_PATH = ["System32", "WindowsPowerShell", "v1.0", "powershell.exe"];
  const KOMOREBI_PREFS_MARKER = "browser.komorebi.";
  const ONBOARDED_PREF = "browser.komorebi.onboarded";
  const ADOPTED_PREF = "browser.komorebi.profileAdopted";
  const ADOPTED_PROFILE_NAME = "default-komorebi";
  const TASKBAR_IDS_KEY = "Software\\Mozilla\\Firefox\\TaskBarIDs";
  const HISTORY_DAYS = 180;
  const HISTORY_MAX_URLS = 20000;
  const HISTORY_BATCH = 500;
  const IMPORT_FOLDER_TITLE = "Imported from Firefox";
  const INSTALL_KEY = "Software\\KomorebiBrowser";
  const SHORTCUT_NAME = "Komorebi Browser";
  // [shortcut folder, directory service key, path inside it], as the installer
  // creates them.
  const SHORTCUTS = [
    ["Programs", "Progs", "Komorebi Browser\\Komorebi Browser.lnk"],
    ["Desktop", "Desk", "Komorebi Browser.lnk"],
  ];

  const lazy = {};
  ChromeUtils.defineESModuleGetters(lazy, {
    BookmarkJSONUtils: "resource://gre/modules/BookmarkJSONUtils.sys.mjs",
    ChromeMigrationUtils:
      "moz-src:///browser/components/migration/ChromeMigrationUtils.sys.mjs",
    MigrationUtils:
      "moz-src:///browser/components/migration/MigrationUtils.sys.mjs",
    PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
    Sqlite: "resource://gre/modules/Sqlite.sys.mjs",
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

  function firefoxFolder() {
    const folder = Services.dirsvc.get("AppData", Ci.nsIFile);
    folder.append("Mozilla");
    folder.append("Firefox");
    return folder;
  }

  function readIni(path) {
    const file = newFile(path);
    if (!file.exists()) {
      return null;
    }
    return Cc["@mozilla.org/xpcom/ini-parser-factory;1"]
      .getService(Ci.nsIINIParserFactory)
      .createINIParser(file);
  }

  function iniSections(ini) {
    const sections = [];
    const names = ini.getSections();
    while (names.hasMore()) {
      sections.push(names.getNext());
    }
    return sections;
  }

  function iniValue(ini, section, key) {
    try {
      return ini.getString(section, key);
    } catch {
      return null;
    }
  }

  function resolveProfilePath(base, path, isRelative) {
    if (!isRelative) {
      return newFile(path.replaceAll("/", "\\")).path;
    }
    const file = newFile(base);
    file.appendRelativePath(path.replaceAll("/", "\\"));
    return file.path;
  }

  function samePath(a, b) {
    return a.toLowerCase() === b.toLowerCase();
  }

  async function hasKomorebiPrefs(profilePath) {
    try {
      const prefs = await IOUtils.readUTF8(PathUtils.join(profilePath, "prefs.js"));
      return prefs.includes(KOMOREBI_PREFS_MARKER);
    } catch {
      return false;
    }
  }

  function taskBarIds() {
    const ids = new Set();
    const key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(
      Ci.nsIWindowsRegKey
    );
    try {
      key.open(
        Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER,
        TASKBAR_IDS_KEY,
        Ci.nsIWindowsRegKey.ACCESS_READ
      );
    } catch {
      return ids;
    }
    try {
      for (let index = 0; index < key.valueCount; index++) {
        const name = key.getValueName(index);
        ids.add(name.toUpperCase());
        try {
          ids.add(key.readStringValue(name).toUpperCase());
        } catch {}
      }
    } finally {
      key.close();
    }
    return ids;
  }

  function ownInstallHash() {
    return Cc["@mozilla.org/xre/directory-provider;1"]
      .getService(Ci.nsIXREDirProvider)
      .getInstallHash();
  }

  async function detectFirefox() {
    const folder = firefoxFolder();
    const profiles = readIni(PathUtils.join(folder.path, "profiles.ini"));
    if (!profiles) {
      return null;
    }
    const current = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
    const candidates = [];
    for (const section of iniSections(profiles)) {
      if (!/^Profile\d+$/.test(section)) {
        continue;
      }
      const path = iniValue(profiles, section, "Path");
      if (!path) {
        continue;
      }
      const root = resolveProfilePath(
        folder.path,
        path,
        iniValue(profiles, section, "IsRelative") !== "0"
      );
      const used = await modifiedTime(PathUtils.join(root, "places.sqlite"));
      if (!used || samePath(root, current) || (await hasKomorebiPrefs(root))) {
        continue;
      }
      candidates.push({
        id: root,
        name: iniValue(profiles, section, "Name") || path,
        used,
      });
    }
    if (!candidates.length) {
      return null;
    }

    let installDefault = null;
    const installs = readIni(PathUtils.join(folder.path, "installs.ini"));
    if (installs) {
      const known = taskBarIds();
      const own = ownInstallHash().toUpperCase();
      for (const section of iniSections(installs)) {
        const hash = section.toUpperCase();
        const marked = iniValue(installs, section, "Default");
        if (marked && hash !== own && known.has(hash)) {
          installDefault = resolveProfilePath(folder.path, marked, true);
          break;
        }
      }
    }
    candidates.sort((a, b) => b.used - a.used);
    const preferred =
      (installDefault &&
        candidates.find(profile => samePath(profile.id, installDefault))) ||
      candidates.find(profile => /default-release/.test(profile.id)) ||
      candidates[0];
    return {
      defaultId: preferred.id,
      profiles: candidates.map(({ id, name }) => ({ id, name })),
      running: await isLocked(preferred.id, "parent.lock"),
    };
  }

  async function newestBookmarkBackup(profilePath) {
    let names;
    try {
      names = await IOUtils.getChildren(
        PathUtils.join(profilePath, "bookmarkbackups")
      );
    } catch {
      return null;
    }
    let newest = null;
    let newestTime = 0;
    for (const path of names) {
      if (!/\.(?:jsonlz4|json)$/.test(path)) {
        continue;
      }
      const time = await modifiedTime(path);
      if (time > newestTime) {
        newest = path;
        newestTime = time;
      }
    }
    return newest;
  }

  const WEB_URL = /^https?:\/\//;

  async function importBookmarksFromDatabase(db) {
    const rows = await db.execute(
      `SELECT b.id, b.type, b.parent, b.title, p.url
       FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk
       WHERE b.type IN (1, 2) AND b.parent > 0
       ORDER BY b.parent, b.position`
    );
    const children = new Map();
    for (const row of rows) {
      const parent = row.getResultByName("parent");
      if (!children.has(parent)) {
        children.set(parent, []);
      }
      children.get(parent).push({
        id: row.getResultByName("id"),
        type: row.getResultByName("type"),
        title: row.getResultByName("title") || "",
        url: row.getResultByName("url"),
      });
    }
    let count = 0;
    const build = parentId =>
      (children.get(parentId) || []).flatMap(node => {
        if (node.type === lazy.PlacesUtils.bookmarks.TYPE_FOLDER) {
          const inner = build(node.id);
          return inner.length
            ? [
                {
                  type: lazy.PlacesUtils.bookmarks.TYPE_FOLDER,
                  title: node.title,
                  children: inner,
                },
              ]
            : [];
        }
        if (!node.url || !WEB_URL.test(node.url)) {
          return [];
        }
        count++;
        return [{ url: node.url, title: node.title }];
      });
    const rootChildren = build(1);
    if (!rootChildren.length) {
      return 0;
    }
    await lazy.PlacesUtils.bookmarks.insertTree(
      {
        guid: lazy.PlacesUtils.bookmarks.toolbarGuid,
        source: lazy.PlacesUtils.bookmarks.SOURCES.IMPORT,
        children: [
          {
            type: lazy.PlacesUtils.bookmarks.TYPE_FOLDER,
            title: IMPORT_FOLDER_TITLE,
            children: rootChildren,
          },
        ],
      },
      { fixupOrSkipInvalidEntries: true }
    );
    return count;
  }

  async function importHistoryFromDatabase(db) {
    const since = (Date.now() - HISTORY_DAYS * 24 * 3600 * 1000) * 1000;
    const pages = new Map();
    await db.execute(
      `SELECT p.url, p.title, v.visit_date
       FROM moz_historyvisits v
       JOIN (
         SELECT id, url, title FROM moz_places
         WHERE last_visit_date > :since
           AND (url LIKE :http OR url LIKE :https)
         ORDER BY last_visit_date DESC LIMIT :cap
       ) p ON p.id = v.place_id
       WHERE v.visit_date > :since`,
      { since, cap: HISTORY_MAX_URLS, http: "http://%", https: "https://%" },
      row => {
        const url = row.getResultByName("url");
        let page = pages.get(url);
        if (!page) {
          page = {
            url,
            title: row.getResultByName("title") || undefined,
            visits: [],
          };
          pages.set(url, page);
        }
        page.visits.push({
          date: new Date(row.getResultByName("visit_date") / 1000),
          transition: lazy.PlacesUtils.history.TRANSITIONS.LINK,
        });
      }
    );
    const all = [...pages.values()];
    for (let start = 0; start < all.length; start += HISTORY_BATCH) {
      await lazy.PlacesUtils.history.insertMany(
        all.slice(start, start + HISTORY_BATCH)
      );
    }
    return all.length;
  }

  async function openCopy(root, leafName, temp) {
    const source = PathUtils.join(root, leafName);
    const copy = PathUtils.join(temp, leafName);
    await IOUtils.copy(source, copy);
    if (await IOUtils.exists(`${source}-wal`)) {
      await IOUtils.copy(`${source}-wal`, `${copy}-wal`);
    }
    return lazy.Sqlite.openConnection({ path: copy, readOnly: true });
  }

  // Firefox stored cookie expiry in seconds before schema 16.
  const COOKIES_MS_SCHEMA = 16;

  async function importCookiesFromDatabase(db) {
    const version = await db.getSchemaVersion();
    const columns = new Set(
      (await db.execute("PRAGMA table_info(moz_cookies)")).map(row =>
        row.getResultByName("name")
      )
    );
    const optional = (row, name, fallback) =>
      columns.has(name) ? (row.getResultByName(name) ?? fallback) : fallback;
    const now = Date.now();
    let count = 0;
    const rows = await db.execute("SELECT * FROM moz_cookies");
    for (const row of rows) {
      let expiry = row.getResultByName("expiry");
      if (version < COOKIES_MS_SCHEMA) {
        expiry *= 1000;
      }
      if (expiry <= now) {
        continue;
      }
      try {
        const originAttributes =
          ChromeUtils.CreateOriginAttributesFromOriginSuffix(
            row.getResultByName("originAttributes") || ""
          );
        const result = Services.cookies.add(
          row.getResultByName("host"),
          row.getResultByName("path"),
          row.getResultByName("name"),
          row.getResultByName("value"),
          !!row.getResultByName("isSecure"),
          !!row.getResultByName("isHttpOnly"),
          false,
          expiry,
          originAttributes,
          optional(row, "sameSite", Ci.nsICookie.SAMESITE_NONE),
          optional(row, "schemeMap", Ci.nsICookie.SCHEME_UNSET),
          !!optional(row, "isPartitionedAttributeSet", 0)
        );
        if (result.result == Ci.nsICookieValidation.eOK) {
          count++;
        }
      } catch (error) {
        console.error("Komorebi skipped a Firefox cookie", error);
      }
    }
    return count;
  }

  /**
   * Copies the bookmarks, history and cookies of a Firefox profile into this
   * one, so sites stay signed in. The profile is only read: the databases are
   * opened from temporary copies. Passwords are not copied, Firefox encrypts
   * them with its own key.
   *
   * @param {{id: string}} profile
   *   An entry of the profiles listed by detectFirefox().
   * @param {Function} onProgress
   * @returns {Promise<{bookmarks: number, history: number}>}
   */
  async function importFromFirefox(profile, onProgress = () => {}) {
    const root = profile?.id;
    if (!root) {
      throw new Error("No Firefox profile to import from");
    }
    if (samePath(root, Services.dirsvc.get("ProfD", Ci.nsIFile).path)) {
      throw new Error("Cannot import from the profile in use");
    }
    const source = PathUtils.join(root, "places.sqlite");
    if (!(await IOUtils.exists(source))) {
      throw new Error("Firefox has no places database");
    }
    const backup = await newestBookmarkBackup(root);
    const temp = PathUtils.join(
      PathUtils.tempDir,
      `komorebi-firefox-${Date.now()}`
    );
    const counts = { bookmarks: 0, history: 0, cookies: 0 };
    await IOUtils.makeDirectory(temp);
    try {
      const db = await openCopy(root, "places.sqlite", temp);
      try {
        onProgress("bookmarks");
        let imported = false;
        if (backup) {
          try {
            counts.bookmarks = await lazy.BookmarkJSONUtils.importFromFile(
              backup,
              { replace: false }
            );
            imported = true;
          } catch (error) {
            console.error("Komorebi could not read the Firefox backup", error);
          }
        }
        if (!imported) {
          counts.bookmarks = await importBookmarksFromDatabase(db);
        }
        onProgress("history");
        counts.history = await importHistoryFromDatabase(db);
      } finally {
        await db.close();
      }
      if (await IOUtils.exists(PathUtils.join(root, "cookies.sqlite"))) {
        onProgress("cookies");
        try {
          const cookies = await openCopy(root, "cookies.sqlite", temp);
          try {
            counts.cookies = await importCookiesFromDatabase(cookies);
          } finally {
            await cookies.close();
          }
        } catch (error) {
          console.error("Komorebi could not copy the Firefox cookies", error);
        }
      }
    } finally {
      await IOUtils.remove(temp, { recursive: true, ignoreAbsent: true }).catch(
        error => console.error("Komorebi could not remove its temp copy", error)
      );
    }
    return counts;
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
   * Older builds kept their profile in Firefox's own folder. On a fresh profile
   * of the split build, registers that folder as the default profile of this
   * browser, without copying or changing it, and restarts into it. Returns
   * true when a restart was started.
   */
  async function adoptPreviousProfile() {
    try {
      if (
        Services.prefs.getBoolPref(ONBOARDED_PREF, false) ||
        Services.prefs.getBoolPref(ADOPTED_PREF, false)
      ) {
        return false;
      }
      const folder = firefoxFolder();
      const current = Services.dirsvc.get("ProfD", Ci.nsIFile);
      if (folder.contains(current)) {
        return false;
      }
      const installs = readIni(PathUtils.join(folder.path, "installs.ini"));
      const marked = installs && iniValue(installs, ownInstallHash(), "Default");
      if (!marked) {
        return false;
      }
      const oldPath = resolveProfilePath(folder.path, marked, true);
      if (
        !(await IOUtils.exists(PathUtils.join(oldPath, "prefs.js"))) ||
        !(await hasKomorebiPrefs(oldPath)) ||
        samePath(oldPath, current.path)
      ) {
        return false;
      }

      const service = Cc["@mozilla.org/toolkit/profile-service;1"].getService(
        Ci.nsIToolkitProfileService
      );
      const oldDir = newFile(oldPath);
      let profile = null;
      try {
        profile = service.getProfileByDir(oldDir);
      } catch {}
      for (let suffix = 0; !profile && suffix < 10; suffix++) {
        const name = suffix
          ? `${ADOPTED_PROFILE_NAME}-${suffix}`
          : ADOPTED_PROFILE_NAME;
        const created = service.createProfile(oldDir, name, "komorebi-adopt");
        if (created.rootDir.equals(oldDir)) {
          profile = created;
        }
      }
      if (!profile) {
        return false;
      }
      service.defaultProfile = profile;
      await service.asyncFlush();

      Services.prefs.setBoolPref(ADOPTED_PREF, true);
      const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile).path;
      runDetachedScript(
        [
          `Wait-Process -Id ${Services.appinfo.processID} -ErrorAction SilentlyContinue`,
          `Start-Process -FilePath ${quoteForPowerShell(exe)}`,
        ].join("; ")
      );
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
      return true;
    } catch (error) {
      console.error("Komorebi could not adopt its previous profile", error);
      return false;
    }
  }

  function installLocation() {
    const key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(
      Ci.nsIWindowsRegKey
    );
    try {
      key.open(key.ROOT_KEY_CURRENT_USER, INSTALL_KEY, key.ACCESS_READ);
      return key.readStringValue("InstallLocation");
    } catch {
      return null;
    } finally {
      key.close();
    }
  }

  /**
   * The taskbar takes its icon from a shortcut carrying the window's
   * AppUserModelID. The installer cannot write that ID, so the installed
   * browser adds it to its own shortcuts on first run.
   */
  async function tagShortcuts() {
    try {
      const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
      const location = installLocation();
      if (!location || !samePath(location, exe.parent.path)) {
        return;
      }
      const aumid = Cc["@mozilla.org/windows-taskbar;1"].getService(
        Ci.nsIWinTaskbar
      ).defaultGroupId;
      const shell = Cc["@mozilla.org/browser/shell-service;1"].getService(
        Ci.nsIWindowsShellService
      );
      if ((await shell.enumerateInstallShortcuts(aumid)).length) {
        return;
      }
      for (const [folder, directoryKey, relativePath] of SHORTCUTS) {
        const parts = relativePath.split("\\");
        const path = PathUtils.join(
          Services.dirsvc.get(directoryKey, Ci.nsIFile).path,
          ...parts
        );
        if (await IOUtils.exists(path)) {
          await shell.createShortcut(
            exe,
            [],
            SHORTCUT_NAME,
            exe,
            0,
            aumid,
            folder,
            relativePath
          );
        }
      }
    } catch (error) {
      console.error("Komorebi could not tag its shortcuts", error);
    }
  }

  global.KomorebiImport = {
    adoptPreviousProfile,
    detect,
    importFromChrome,
    importFromFirefox,
    providers,
    runDetachedScript,
    tagShortcuts,
  };
})(this);
