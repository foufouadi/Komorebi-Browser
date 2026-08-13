// ============================================================
// KOMOREBI - PROCESS SCRIPT
// Charge dans chaque process content par le loader.
// Injecte la feuille qui rend about:home/about:newtab transparent.
// ============================================================

(function() {
  'use strict';

  const ABOUT_URI = /^about:(home|newtab|welcome)(?:[?#].*)?$/;
  const GOOGLE_SEARCH_URI =
    /^https:\/\/(?:www\.)?google\.[^/]+\/search(?:[?#]|$)/;

  const sheetService = Cc['@mozilla.org/content/style-sheet-service;1'].getService(
    Ci.nsIStyleSheetService
  );
  // Feuille compilee une seule fois, partagee entre tous les documents.
  const aboutSheet = sheetService.preloadSheet(
    Services.io.newURI(
      'chrome://browser/content/komorebi/komorebi-transparent.css'
    ),
    sheetService.AUTHOR_SHEET
  );
  const googleSheet = sheetService.preloadSheet(
    Services.io.newURI(
      'chrome://browser/content/komorebi/komorebi-google.css'
    ),
    sheetService.AUTHOR_SHEET
  );

  const alreadyApplied = new WeakSet();

  function makeTransparent(doc) {
    if (alreadyApplied.has(doc)) {
      return;
    }

    const uri = doc.documentURI;
    let sheet = null;
    if (ABOUT_URI.test(uri)) {
      sheet = aboutSheet;
    } else if (GOOGLE_SEARCH_URI.test(uri)) {
      sheet = googleSheet;
    }
    if (!sheet) {
      return;
    }

    alreadyApplied.add(doc);
    const win = doc.defaultView;
    if (win) {
      win.windowUtils.addSheet(sheet, win.windowUtils.AUTHOR_SHEET);
    }
  }

  Services.obs.addObserver(makeTransparent, 'document-element-inserted');

  // Rattrapage pour un document deja charge quand le script arrive
  // dans le process (onglet about:home initial de la fenetre).
  if (typeof content !== 'undefined' && content.document) {
    makeTransparent(content.document);
  }
})();
