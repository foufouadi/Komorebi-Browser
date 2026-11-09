/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* globals gBrowser */

(function () {
  "use strict";

  const PROCESS_SCRIPT =
    "chrome://browser/content/komorebi/komorebi-process.js";
  const MODULE_SCRIPTS = [
    "chrome://browser/content/komorebi/komorebi-host.js",
    "chrome://browser/content/komorebi/komorebi-web-renderer.js",
    "chrome://browser/content/komorebi/komorebi-library.js",
    "chrome://browser/content/komorebi/komorebi-compact.js",
    "chrome://browser/content/komorebi/komorebi-spaces.js",
    "chrome://browser/content/komorebi/komorebi-sleep.js",
    "chrome://browser/content/komorebi/komorebi-search.js",
    "chrome://browser/content/komorebi/komorebi-tools.js",
    "chrome://browser/content/komorebi/komorebi-onboarding.js",
  ];
  const FEATURES = [
    "KomorebiCompact",
    "KomorebiSpaces",
    "KomorebiSleep",
    "KomorebiSearch",
    "KomorebiTools",
    "KomorebiOnboarding",
  ];
  const HOME_PAGE = /^about:(?:home|newtab|welcome)(?:[?#].*)?$/;
  const SEARCH_PAGE = /^https:\/\/(?:www\.)?google\.[^/]+\/search(?:[?#]|$)/;
  const KOMOREBI_BRANCH = "browser.komorebi.";
  const POWER_MODE_PREF = "browser.komorebi.powerMode";
  const PAUSE_BACKGROUND_PREF = "browser.komorebi.pauseInBackground";
  const MUSIC_SCOPE_PREF = "browser.komorebi.musicScope";
  const MUSIC_BACKGROUND_PREF = "browser.komorebi.pauseMusicInBackground";
  const TAB_AUDIO_PREF = "browser.komorebi.muteForTabAudio";
  const SEARCH_WALLPAPER_PREF = "browser.komorebi.searchWallpaper";
  const PAGE_STATE_PREFS = new Set([
    POWER_MODE_PREF,
    PAUSE_BACKGROUND_PREF,
    MUSIC_SCOPE_PREF,
    MUSIC_BACKGROUND_PREF,
    TAB_AUDIO_PREF,
    SEARCH_WALLPAPER_PREF,
  ]);
  const WALLPAPER_ACTIVE_PREF = "browser.komorebi.wallpaperActive";
  const OPEN_LIBRARY_MESSAGE = "Komorebi:OpenLibrary";

  Services.prefs.setBoolPref("browser.tabs.allow_transparent_browser", true);

  function centerFirstWindow() {
    try {
      const { AppConstants } = ChromeUtils.importESModule(
        "resource://gre/modules/AppConstants.sys.mjs"
      );
      if (
        Services.xulStore.hasValue(
          AppConstants.BROWSER_CHROME_URL,
          "main-window",
          "screenX"
        ) ||
        window.windowState !== window.STATE_NORMAL ||
        window.outerWidth < 200 ||
        window.outerHeight < 200 ||
        Array.from(Services.wm.getEnumerator("navigator:browser")).length !== 1
      ) {
        return;
      }
      const { screen } = window;
      window.moveTo(
        screen.availLeft +
          Math.max(0, Math.round((screen.availWidth - window.outerWidth) / 2)),
        screen.availTop +
          Math.max(0, Math.round((screen.availHeight - window.outerHeight) / 2))
      );
    } catch (error) {
      console.error("Komorebi could not center the window", error);
    }
  }

  centerFirstWindow();
  window.addEventListener("load", centerFirstWindow, { once: true });
  window.addEventListener("MozAfterPaint", centerFirstWindow, { once: true });

  const processScriptLoaded = Array.from(
    Services.ppmm.getDelayedProcessScripts(),
    ([uri]) => uri
  ).includes(PROCESS_SCRIPT);
  if (!processScriptLoaded) {
    Services.ppmm.loadProcessScript(PROCESS_SCRIPT, true);
  }

  window.windowUtils.loadSheet(
    Services.io.newURI("chrome://browser/content/komorebi/komorebi-chrome.css"),
    window.windowUtils.AUTHOR_SHEET
  );

  window.windowUtils.loadSheet(
    Services.io.newURI(
      "chrome://browser/content/komorebi/komorebi-features.css"
    ),
    window.windowUtils.AUTHOR_SHEET
  );

  for (const script of MODULE_SCRIPTS) {
    Services.scriptloader.loadSubScript(script, window);
  }

  let host;
  let renderers;
  let wallpaperSelected = false;
  const progressListener = {
    onLocationChange() {
      updatePageState();
    },
  };
  const openLibraryListener = {
    receiveMessage() {
      if (Services.wm.getMostRecentBrowserWindow() === window) {
        window.KomorebiLibrary.open();
      }
    },
  };
  const prefsListener = {
    observe(subject, topic, name) {
      if (PAGE_STATE_PREFS.has(name)) {
        updatePageState();
      }
    },
  };
  const tabAudioListener = event => {
    const changed = event.detail?.changed;
    if (changed?.includes("soundplaying") || changed?.includes("muted")) {
      updatePageState();
    }
  };
  const tabCloseListener = event => updatePageState(event.target);

  function isTabAudioPlaying(ignoredTab) {
    return Array.from(gBrowser.tabs).some(
      tab =>
        tab !== ignoredTab &&
        !tab.closing &&
        tab.hasAttribute("soundplaying") &&
        !tab.hasAttribute("muted")
    );
  }

  function isMusicInScope(scope, kind) {
    if (scope === "everywhere") {
      return true;
    }
    return scope === "search" ? Boolean(kind) : kind === "home";
  }

  function updatePageState(ignoredTab) {
    if (!renderers) {
      return;
    }
    const uri = gBrowser.selectedBrowser.currentURI?.spec || "";
    const kind = HOME_PAGE.test(uri)
      ? "home"
      : SEARCH_PAGE.test(uri)
        ? "search"
        : null;
    const prefs = Services.prefs;
    const searchMode = prefs.getStringPref(SEARCH_WALLPAPER_PREF, "full");
    const pageActive =
      kind === "home" || (kind === "search" && searchMode !== "off");
    const unfocused = !document.hasFocus();
    const minimized =
      window.windowState === window.STATE_MINIMIZED || window.isFullyOccluded;
    const freezeInBackground =
      prefs.getStringPref(POWER_MODE_PREF, "balanced") === "eco" ||
      prefs.getBoolPref(PAUSE_BACKGROUND_PREF, false);
    const running = !minimized && (!unfocused || !freezeInBackground);
    const audioAllowed =
      isMusicInScope(prefs.getStringPref(MUSIC_SCOPE_PREF, "newtab"), kind) &&
      !(
        prefs.getBoolPref(MUSIC_BACKGROUND_PREF, true) &&
        (minimized || unfocused)
      );
    const audioDucked =
      prefs.getBoolPref(TAB_AUDIO_PREF, true) &&
      isTabAudioPlaying(ignoredTab?.localName === "tab" ? ignoredTab : null);
    for (const renderer of [renderers.scene, renderers.video]) {
      renderer.setPageActive(pageActive);
      renderer.setRunning(running);
      renderer.setAudioAllowed(audioAllowed);
      renderer.setAudioDucked(audioDucked);
    }
    const root = document.documentElement;
    root.toggleAttribute("komorebi-active", wallpaperSelected && pageActive);
  }

  function setWallpaperSelected(selected) {
    wallpaperSelected = selected;
    Services.prefs.setBoolPref(WALLPAPER_ACTIVE_PREF, selected);
    updatePageState();
  }

  function cleanup() {
    gBrowser.removeTabsProgressListener(progressListener);
    gBrowser.tabContainer.removeEventListener("TabSelect", updatePageState);
    gBrowser.tabContainer.removeEventListener(
      "TabAttrModified",
      tabAudioListener
    );
    gBrowser.tabContainer.removeEventListener("TabClose", tabCloseListener);
    window.removeEventListener("sizemodechange", updatePageState);
    window.removeEventListener("occlusionstatechange", updatePageState);
    window.removeEventListener("focus", updatePageState);
    window.removeEventListener("blur", updatePageState);
    Services.prefs.removeObserver(KOMOREBI_BRANCH, prefsListener);
    Services.ppmm.removeMessageListener(
      OPEN_LIBRARY_MESSAGE,
      openLibraryListener
    );
    host?.destroy();
  }

  async function init() {
    host = new window.KomorebiWallpaperHost();
    renderers = {
      scene: host.scene,
      video: host.video,
      web: new window.KomorebiWebRenderer(),
    };
    renderers.scene.init();
    renderers.video.init();
    gBrowser.addTabsProgressListener(progressListener);
    gBrowser.tabContainer.addEventListener("TabSelect", updatePageState);
    gBrowser.tabContainer.addEventListener("TabAttrModified", tabAudioListener);
    gBrowser.tabContainer.addEventListener("TabClose", tabCloseListener);
    window.addEventListener("sizemodechange", updatePageState);
    window.addEventListener("occlusionstatechange", updatePageState);
    window.addEventListener("focus", updatePageState);
    window.addEventListener("blur", updatePageState);
    Services.prefs.addObserver(KOMOREBI_BRANCH, prefsListener);
    Services.ppmm.addMessageListener(OPEN_LIBRARY_MESSAGE, openLibraryListener);
    window.addEventListener("unload", cleanup, { once: true });
    updatePageState();

    await window.KomorebiLibrary.init({
      renderers,
      setWallpaperSelected,
    });

    for (const name of FEATURES) {
      Promise.resolve()
        .then(() => window[name].init())
        .catch(reportError);
    }
  }

  if (document.readyState === "loading") {
    window.addEventListener(
      "DOMContentLoaded",
      () => init().catch(reportError),
      {
        once: true,
      }
    );
  } else {
    init().catch(reportError);
  }

  function reportError(error) {
    console.error("Komorebi failed to initialize", error);
  }
})();
