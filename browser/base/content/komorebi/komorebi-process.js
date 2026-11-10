/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* globals content */

// ============================================================
// KOMOREBI - PROCESS SCRIPT
// Charge dans chaque process content par le loader.
// Injecte la feuille qui rend about:home/about:newtab transparent.
// ============================================================

(function () {
  "use strict";

  const ABOUT_URI = /^about:(home|newtab|welcome)(?:[?#].*)?$/;
  const GOOGLE_SEARCH_URI =
    /^https:\/\/(?:www\.)?google\.[^/]+\/search(?:[?#]|$)/;

  const sheetService = Cc[
    "@mozilla.org/content/style-sheet-service;1"
  ].getService(Ci.nsIStyleSheetService);
  // Feuille compilee une seule fois, partagee entre tous les documents.
  const aboutSheet = sheetService.preloadSheet(
    Services.io.newURI(
      "chrome://browser/content/komorebi/komorebi-transparent.css"
    ),
    sheetService.AUTHOR_SHEET
  );
  const googleSheet = sheetService.preloadSheet(
    Services.io.newURI("chrome://browser/content/komorebi/komorebi-google.css"),
    sheetService.AUTHOR_SHEET
  );

  const alreadyApplied = new WeakSet();
  const OPEN_LIBRARY_MESSAGE = "Komorebi:OpenLibrary";
  const CUSTOMIZE_BUTTON_CLASS = "komorebi-customize-button";
  const CONTENT_SCHEME_PREF = "browser.komorebi.contentScheme";
  const WALLPAPER_ACTIVE_PREF = "browser.komorebi.wallpaperActive";
  const SEARCH_OPACITY_PREF = "browser.komorebi.searchBlockOpacity";
  const DEFAULT_SEARCH_OPACITY = 70;

  function watchCustomizePanel(doc, win) {
    const insertButton = () => {
      const section = doc.querySelector(".customize-menu .home-section");
      if (!section || section.querySelector(`.${CUSTOMIZE_BUTTON_CLASS}`)) {
        return;
      }
      const button = doc.createElement("button");
      button.type = "button";
      button.className = CUSTOMIZE_BUTTON_CLASS;
      button.textContent = "Komorebi wallpapers";
      button.addEventListener("click", () =>
        Services.cpmm.sendAsyncMessage(OPEN_LIBRARY_MESSAGE)
      );
      section.prepend(button);
    };
    const observer = new win.MutationObserver(insertButton);
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    win.addEventListener("pagehide", () => observer.disconnect(), {
      once: true,
    });
    insertButton();
  }

  function watchContentScheme(doc, win) {
    const root = doc.documentElement;
    const apply = () => {
      const scheme = Services.prefs.getStringPref(CONTENT_SCHEME_PREF, "");
      if (scheme) {
        root.setAttribute("komorebi-scheme", scheme);
      } else {
        root.removeAttribute("komorebi-scheme");
      }
    };
    Services.prefs.addObserver(CONTENT_SCHEME_PREF, apply);
    win.addEventListener(
      "pagehide",
      () => Services.prefs.removeObserver(CONTENT_SCHEME_PREF, apply),
      { once: true }
    );
    apply();
  }

  function watchWallpaperActive(doc, win) {
    const root = doc.documentElement;
    const apply = () => {
      root.toggleAttribute(
        "komorebi-wallpaper",
        Services.prefs.getBoolPref(WALLPAPER_ACTIVE_PREF, false)
      );
    };
    Services.prefs.addObserver(WALLPAPER_ACTIVE_PREF, apply);
    win.addEventListener(
      "pagehide",
      () => Services.prefs.removeObserver(WALLPAPER_ACTIVE_PREF, apply),
      { once: true }
    );
    apply();
  }

  function watchSearchOpacity(doc, win) {
    const root = doc.documentElement;
    const apply = () => {
      const opacity = Services.prefs.getIntPref(
        SEARCH_OPACITY_PREF,
        DEFAULT_SEARCH_OPACITY
      );
      root.style.setProperty("--komorebi-glass-alpha", `${opacity}%`);
    };
    Services.prefs.addObserver(SEARCH_OPACITY_PREF, apply);
    win.addEventListener(
      "pagehide",
      () => Services.prefs.removeObserver(SEARCH_OPACITY_PREF, apply),
      { once: true }
    );
    apply();
  }

  function makeTransparent(doc) {
    if (alreadyApplied.has(doc)) {
      return;
    }

    const uri = doc.documentURI;
    const isAbout = ABOUT_URI.test(uri);
    if (!isAbout && !GOOGLE_SEARCH_URI.test(uri)) {
      return;
    }

    alreadyApplied.add(doc);
    const win = doc.defaultView;
    if (!win) {
      return;
    }
    if (isAbout) {
      win.windowUtils.addSheet(aboutSheet, win.windowUtils.AUTHOR_SHEET);
      watchWallpaperActive(doc, win);
      watchCustomizePanel(doc, win);
      watchContentScheme(doc, win);
    } else {
      win.windowUtils.addSheet(googleSheet, win.windowUtils.AUTHOR_SHEET);
      doc.documentElement.setAttribute("komorebi-wallpaper", "");
      watchSearchOpacity(doc, win);
    }
  }

  Services.obs.addObserver(makeTransparent, "document-element-inserted");

  // Rattrapage pour un document deja charge quand le script arrive
  // dans le process (onglet about:home initial de la fenetre).
  if (typeof content !== "undefined" && content.document) {
    makeTransparent(content.document);
  }
})();
