/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

(function (global) {
  "use strict";

  const lazy = {};
  ChromeUtils.defineESModuleGetters(lazy, {
    SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  });

  const ADDED_PREF = "browser.komorebi.searchShortcutsAdded";
  const SHORTCUTS = [
    {
      alias: "!yt",
      name: "YouTube",
      url: "https://www.youtube.com/results?search_query={searchTerms}",
    },
    {
      alias: "!w",
      name: "Wikipedia",
      url: "https://en.wikipedia.org/w/index.php?search={searchTerms}",
    },
    {
      alias: "!gh",
      name: "GitHub",
      url: "https://github.com/search?q={searchTerms}",
    },
    {
      alias: "!r",
      name: "Reddit",
      url: "https://www.reddit.com/search/?q={searchTerms}",
    },
    {
      alias: "!a",
      name: "Amazon",
      url: "https://www.amazon.com/s?k={searchTerms}",
    },
    {
      alias: "!m",
      name: "Google Maps",
      url: "https://www.google.com/maps/search/{searchTerms}",
    },
  ];

  async function addShortcuts() {
    if (Services.prefs.getBoolPref(ADDED_PREF, false)) {
      return;
    }
    await lazy.SearchService.init();
    for (const shortcut of SHORTCUTS) {
      try {
        if (
          lazy.SearchService.getEngineByName(shortcut.name) ||
          (await lazy.SearchService.getEngineByAlias(shortcut.alias))
        ) {
          continue;
        }
        await lazy.SearchService.addUserEngine(shortcut);
      } catch (error) {
        console.error(`Komorebi could not add ${shortcut.name}`, error);
      }
    }
    Services.prefs.setBoolPref(ADDED_PREF, true);
  }

  function init() {
    addShortcuts().catch(error =>
      console.error("Komorebi could not add search shortcuts", error)
    );
  }

  global.KomorebiSearch = { init };
})(this);
