/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* globals gBrowser */

(function (global) {
  "use strict";

  const SLEEP_PREF = "browser.komorebi.sleepAfterMinutes";
  const CHECK_INTERVAL_MS = 60 * 1000;

  let timer = null;

  function isSleepable(tab, limitMs) {
    return (
      !tab.selected &&
      !tab.pinned &&
      !tab.closing &&
      !tab.soundPlaying &&
      !tab.hasAttribute("pending") &&
      !tab.hasAttribute("sharing") &&
      !tab.hasAttribute("pictureinpicture") &&
      !tab.hasAttribute("busy") &&
      !tab.linkedBrowser._sharingState?.webRTC?.sharing &&
      Date.now() - tab.lastAccessed > limitMs
    );
  }

  function sleepInactiveTabs() {
    const minutes = Services.prefs.getIntPref(SLEEP_PREF, 30);
    if (minutes <= 0) {
      return;
    }
    for (const tab of gBrowser.tabs) {
      if (isSleepable(tab, minutes * 60 * 1000)) {
        gBrowser.discardBrowser(tab, false);
      }
    }
  }

  function init() {
    if (timer) {
      return;
    }
    timer = window.setInterval(sleepInactiveTabs, CHECK_INTERVAL_MS);
    window.addEventListener("unload", () => window.clearInterval(timer), {
      once: true,
    });
  }

  global.KomorebiSleep = { init, check: sleepInactiveTabs };
})(this);
