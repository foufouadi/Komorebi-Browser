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

  const WIDGET_ID = "komorebi-tools-button";
  const VIEW_ID = "komorebi-tools-view";
  const PLACED_PREF = "browser.komorebi.toolsPlaced";
  const WORK_MS = 25 * 60 * 1000;
  const BREAK_MS = 5 * 60 * 1000;
  const SAVE_DELAY_MS = 600;
  const BREAK_DURATIONS = [5, 10, 15, 30];

  const AlertNotification = Components.Constructor(
    "@mozilla.org/alert-notification;1",
    "nsIAlertNotification",
    "initWithObject"
  );

  const timer = {
    phase: "work",
    running: false,
    remainingMs: WORK_MS,
    endAt: 0,
    interval: null,
  };
  const rest = {
    active: false,
    endAt: 0,
    interval: null,
    overlay: null,
    countdown: null,
    resizeObserver: null,
  };
  let notesArea = null;
  let notesTimer = null;
  let notesLoaded = false;
  let timerDisplay = null;
  let timerPhase = null;
  let timerToggle = null;

  function notesPath() {
    return PathUtils.join(PathUtils.profileDir, "komorebi", "notes.txt");
  }

  async function loadNotes() {
    if (!notesArea) {
      return;
    }
    try {
      if (await IOUtils.exists(notesPath())) {
        notesArea.value = await IOUtils.readUTF8(notesPath());
      }
      notesLoaded = true;
    } catch (error) {
      console.error("Komorebi could not read the notes", error);
    }
  }

  async function saveNotes() {
    window.clearTimeout(notesTimer);
    if (!notesArea || !notesLoaded) {
      return;
    }
    try {
      await IOUtils.makeDirectory(PathUtils.parent(notesPath()), {
        createAncestors: true,
      });
      await IOUtils.writeUTF8(notesPath(), notesArea.value);
    } catch (error) {
      console.error("Komorebi could not save the notes", error);
    }
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = String(Math.floor(total / 60)).padStart(2, "0");
    const seconds = String(total % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function timerRemaining() {
    return timer.running ? timer.endAt - Date.now() : timer.remainingMs;
  }

  async function notify(titleId, textId) {
    try {
      const [title, text] = await document.l10n.formatValues([titleId, textId]);
      Cc["@mozilla.org/alerts-service;1"]
        .getService(Ci.nsIAlertsService)
        .showAlert(new AlertNotification({ title, text }));
    } catch (error) {
      console.error("Komorebi could not show the notification", error);
    }
  }

  function renderTimer() {
    const remaining = timerRemaining();
    if (timerDisplay) {
      timerDisplay.textContent = formatClock(remaining);
      document.l10n.setAttributes(timerPhase, `komorebi-timer-${timer.phase}`);
      document.l10n.setAttributes(
        timerToggle,
        timer.running ? "komorebi-timer-pause" : "komorebi-timer-start"
      );
    }
    const button = document.getElementById(WIDGET_ID);
    if (button) {
      const active = timer.running || remaining < phaseLength();
      button.toggleAttribute("badged", active);
      if (active) {
        button.setAttribute("badge", String(Math.ceil(remaining / 60000)));
      } else {
        button.removeAttribute("badge");
      }
    }
  }

  function phaseLength() {
    return timer.phase === "work" ? WORK_MS : BREAK_MS;
  }

  function tickTimer() {
    if (timer.running && timer.endAt - Date.now() <= 0) {
      const finished = timer.phase;
      timer.phase = finished === "work" ? "break" : "work";
      timer.endAt = Date.now() + phaseLength();
      notify(
        finished === "work"
          ? "komorebi-timer-work-done-title"
          : "komorebi-timer-break-done-title",
        finished === "work"
          ? "komorebi-timer-work-done-text"
          : "komorebi-timer-break-done-text"
      );
    }
    renderTimer();
  }

  function toggleTimer() {
    if (timer.running) {
      timer.remainingMs = timer.endAt - Date.now();
      timer.running = false;
      window.clearInterval(timer.interval);
    } else {
      timer.endAt = Date.now() + timer.remainingMs;
      timer.running = true;
      timer.interval = window.setInterval(tickTimer, 1000);
    }
    renderTimer();
  }

  function resetTimer() {
    window.clearInterval(timer.interval);
    timer.running = false;
    timer.phase = "work";
    timer.remainingMs = WORK_MS;
    renderTimer();
  }

  function placeOverlay() {
    const rect = gBrowser.tabpanels.getBoundingClientRect();
    const style = rest.overlay.style;
    style.top = `${rect.top}px`;
    style.left = `${rect.left}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
  }

  function endBreak(finished = false) {
    if (!rest.active) {
      return;
    }
    rest.active = false;
    window.clearInterval(rest.interval);
    rest.resizeObserver?.disconnect();
    rest.overlay?.remove();
    rest.overlay = null;
    gBrowser.selectedBrowser.focus();
    if (finished) {
      notify("komorebi-break-over-title", "komorebi-break-over-text");
    }
  }

  function tickBreak() {
    const remaining = rest.endAt - Date.now();
    if (remaining <= 0) {
      endBreak(true);
      return;
    }
    rest.countdown.textContent = formatClock(remaining);
  }

  function startBreak(minutes) {
    if (rest.active) {
      return;
    }
    rest.active = true;
    rest.endAt = Date.now() + minutes * 60 * 1000;

    const overlay = document.createElement("div");
    overlay.id = "komorebi-break-overlay";
    overlay.setAttribute("role", "dialog");
    document.l10n.setAttributes(overlay, "komorebi-break-overlay");
    const title = document.createElement("p");
    title.className = "komorebi-break-title";
    document.l10n.setAttributes(title, "komorebi-break-title");
    rest.countdown = document.createElement("p");
    rest.countdown.className = "komorebi-break-countdown";
    const end = document.createElement("moz-button");
    end.setAttribute("type", "primary");
    document.l10n.setAttributes(end, "komorebi-break-end");
    end.addEventListener("click", () => endBreak());
    overlay.append(title, rest.countdown, end);
    document.body.appendChild(overlay);
    rest.overlay = overlay;

    placeOverlay();
    rest.resizeObserver = new ResizeObserver(placeOverlay);
    rest.resizeObserver.observe(gBrowser.tabpanels);
    tickBreak();
    rest.interval = window.setInterval(tickBreak, 1000);
    end.focus();
  }

  function createSection(titleId, ...children) {
    const section = document.createElement("section");
    section.className = "komorebi-tools-section";
    const heading = document.createElement("h3");
    document.l10n.setAttributes(heading, titleId);
    section.append(heading, ...children);
    return section;
  }

  function createButton(l10nId, onClick, type = "default") {
    const button = document.createElement("moz-button");
    button.setAttribute("type", type);
    document.l10n.setAttributes(button, l10nId);
    button.addEventListener("click", onClick);
    return button;
  }

  function createNotesSection() {
    notesArea = document.createElement("textarea");
    notesArea.id = "komorebi-notes";
    notesArea.rows = 6;
    document.l10n.setAttributes(notesArea, "komorebi-notes-field");
    notesArea.addEventListener("input", () => {
      window.clearTimeout(notesTimer);
      notesTimer = window.setTimeout(saveNotes, SAVE_DELAY_MS);
    });
    return createSection("komorebi-notes-title", notesArea);
  }

  function createTimerSection() {
    timerPhase = document.createElement("span");
    timerPhase.className = "komorebi-timer-phase";
    timerDisplay = document.createElement("span");
    timerDisplay.className = "komorebi-timer-display";
    const readout = document.createElement("div");
    readout.className = "komorebi-timer-readout";
    readout.append(timerDisplay, timerPhase);

    timerToggle = createButton("komorebi-timer-start", toggleTimer, "primary");
    const controls = document.createElement("div");
    controls.className = "komorebi-tools-row";
    controls.append(
      timerToggle,
      createButton("komorebi-timer-reset", resetTimer)
    );
    return createSection("komorebi-timer-title", readout, controls);
  }

  function createBreakSection() {
    const select = document.createElement("select");
    select.id = "komorebi-break-duration";
    for (const minutes of BREAK_DURATIONS) {
      const option = document.createElement("option");
      option.value = String(minutes);
      document.l10n.setAttributes(option, "komorebi-break-minutes", {
        minutes,
      });
      select.appendChild(option);
    }
    const row = document.createElement("div");
    row.className = "komorebi-tools-row";
    row.append(
      select,
      createButton(
        "komorebi-break-start",
        () => {
          const panel = document.getElementById(VIEW_ID)?.closest("panel");
          panel?.hidePopup();
          startBreak(Number(select.value));
        },
        "primary"
      )
    );
    return createSection("komorebi-break-section-title", row);
  }

  function buildView(doc) {
    const view = doc.createXULElement("panelview");
    view.id = VIEW_ID;
    view.className = "PanelUI-subView";
    const body = doc.createElement("div");
    body.className = "panel-subview-body komorebi-tools-body";
    body.append(
      createNotesSection(),
      createTimerSection(),
      createBreakSection()
    );
    view.appendChild(body);
    doc.getElementById("appMenu-viewCache").appendChild(view);
    renderTimer();
    return view;
  }

  async function onViewShowing() {
    renderTimer();
    await loadNotes();
  }

  function onViewHiding() {
    saveNotes();
  }

  function registerWidget() {
    try {
      if (
        CustomizableUI.getWidget(WIDGET_ID)?.provider ===
        CustomizableUI.PROVIDER_API
      ) {
        return;
      }
      CustomizableUI.createWidget({
        id: WIDGET_ID,
        type: "view",
        viewId: VIEW_ID,
        l10nId: "komorebi-tools-button",
        defaultArea: CustomizableUI.AREA_NAVBAR,
        onBeforeCreated(doc) {
          doc.defaultView.KomorebiTools.buildView(doc);
        },
        onViewShowing(event) {
          event.target.ownerDocument.defaultView.KomorebiTools?.onViewShowing();
        },
        onViewHiding(event) {
          event.target.ownerDocument.defaultView.KomorebiTools?.onViewHiding();
        },
        onCreated(node) {
          node.ownerDocument.defaultView.KomorebiTools?.render();
        },
      });
      if (!Services.prefs.getBoolPref(PLACED_PREF, false)) {
        Services.prefs.setBoolPref(PLACED_PREF, true);
        if (!CustomizableUI.getPlacementOfWidget(WIDGET_ID, false, true)) {
          CustomizableUI.addWidgetToArea(WIDGET_ID, CustomizableUI.AREA_NAVBAR);
        }
      }
    } catch (error) {
      console.error("Komorebi could not register the tools panel", error);
    }
  }

  function init() {
    global.MozXULElement.insertFTLIfNeeded("browser/komorebi.ftl");
    registerWidget();
    window.addEventListener(
      "unload",
      () => {
        window.clearInterval(timer.interval);
        window.clearInterval(rest.interval);
        rest.resizeObserver?.disconnect();
        saveNotes();
      },
      { once: true }
    );
  }

  global.KomorebiTools = {
    init,
    buildView,
    onViewShowing,
    onViewHiding,
    render: renderTimer,
    startBreak,
    endBreak,
    toggleTimer,
    resetTimer,
  };
})(this);
