/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* globals gURLBar */

(function (global) {
  "use strict";

  const COMPACT_PREF = "browser.komorebi.compact";
  const HIDE_DELAY_MS = 450;
  const REVEALED = "komorebi-compact-revealed";

  let started = false;

  function init() {
    if (started) {
      return;
    }
    started = true;

    const root = document.documentElement;
    const toolbox = document.getElementById("navigator-toolbox");
    const edge = document.createElement("div");
    edge.id = "komorebi-compact-edge";
    document.body.appendChild(edge);

    const openPopups = new Set();
    let hoverEdge = false;
    let hoverToolbox = false;
    let hideTimer = null;

    function enabled() {
      return Services.prefs.getBoolPref(COMPACT_PREF, false);
    }

    function mustStayOpen() {
      return (
        hoverEdge ||
        hoverToolbox ||
        openPopups.size > 0 ||
        root.hasAttribute("customizing") ||
        Boolean(gURLBar?.focused) ||
        toolbox.contains(document.activeElement)
      );
    }

    function reveal() {
      window.clearTimeout(hideTimer);
      if (enabled()) {
        root.toggleAttribute(REVEALED, true);
      }
    }

    function scheduleHide() {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!mustStayOpen()) {
          root.removeAttribute(REVEALED);
        }
      }, HIDE_DELAY_MS);
    }

    function isToolboxPopup(popup) {
      if (popup.localName === "tooltip") {
        return false;
      }
      const anchor = popup.anchorNode || popup.triggerNode;
      return toolbox.contains(popup) || Boolean(anchor && toolbox.contains(anchor));
    }

    function sync() {
      root.toggleAttribute("komorebi-compact", enabled());
      if (!enabled()) {
        root.removeAttribute(REVEALED);
      }
    }

    edge.addEventListener("mouseenter", () => {
      hoverEdge = true;
      reveal();
    });
    edge.addEventListener("mouseleave", () => {
      hoverEdge = false;
      scheduleHide();
    });
    toolbox.addEventListener("mouseenter", () => {
      hoverToolbox = true;
      reveal();
    });
    toolbox.addEventListener("mouseleave", () => {
      hoverToolbox = false;
      scheduleHide();
    });
    toolbox.addEventListener("focusin", reveal);
    toolbox.addEventListener("focusout", scheduleHide);

    window.addEventListener(
      "popupshown",
      event => {
        if (isToolboxPopup(event.target)) {
          openPopups.add(event.target);
          reveal();
        }
      },
      true
    );
    window.addEventListener(
      "popuphidden",
      event => {
        if (openPopups.delete(event.target)) {
          scheduleHide();
        }
      },
      true
    );

    const customizeObserver = new MutationObserver(() => {
      if (root.hasAttribute("customizing")) {
        reveal();
      } else {
        scheduleHide();
      }
    });
    customizeObserver.observe(root, {
      attributes: true,
      attributeFilter: ["customizing"],
    });

    const prefObserver = { observe: sync };
    Services.prefs.addObserver(COMPACT_PREF, prefObserver);

    const key = document.createXULElement("key");
    key.id = "komorebi-key-compact";
    key.setAttribute("key", "C");
    key.setAttribute("modifiers", "control,alt");
    key.addEventListener("command", () =>
      Services.prefs.setBoolPref(COMPACT_PREF, !enabled())
    );
    document.getElementById("mainKeyset").appendChild(key);

    window.addEventListener(
      "unload",
      () => {
        window.clearTimeout(hideTimer);
        customizeObserver.disconnect();
        Services.prefs.removeObserver(COMPACT_PREF, prefObserver);
      },
      { once: true }
    );

    sync();
  }

  global.KomorebiCompact = { init };
})(this);
