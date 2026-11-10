/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* globals CustomizableUI, openTrustedLinkIn */

(function (global) {
  "use strict";

  const ONBOARDED_PREF = "browser.komorebi.onboarded";
  const BUTTON_HINT_PREF = "browser.komorebi.buttonHintShown";
  const TOOLBAR_BUTTON_ID = "komorebi-toolbar-button";
  const HINT_DELAY_MS = 450;
  const COMPACT_PREF = "browser.komorebi.compact";
  const REVAMP_PREF = "sidebar.revamp";
  const VERTICAL_PREF = "sidebar.verticalTabs";
  const FINGERPRINT_PREF = "privacy.fingerprintingProtection";
  const STORE_URL = "https://store.steampowered.com/app/431960/";
  const UBLOCK_URL =
    "https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi";
  const MAX_WALLPAPERS = 12;
  const CLOSE_DELAY_MS = 220;
  const STEPS = [
    "welcome",
    "import",
    "wallpapers",
    "layout",
    "search",
    "privacy",
    "done",
  ];
  const IMPORT_SOURCES = ["chrome", "firefox"];
  const IMPORT_WAIT_MS = 60000;

  const lazy = {};
  ChromeUtils.defineESModuleGetters(lazy, {
    AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
    SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  });

  let dialog = null;
  let stage = null;
  let dots = [];
  let backButton = null;
  let nextButton = null;
  let skipButton = null;
  let index = 0;
  let ublockState = "idle";
  let finished = false;
  let backdrops = [];
  let backdropToken = 0;
  let steps = STEPS;
  let importState = null;
  let opening = false;

  function showBackdrop(uri) {
    if (!backdrops.length) {
      return;
    }
    const token = ++backdropToken;
    const current = backdrops.find(image => image.classList.contains("shown"));
    if (!uri) {
      current?.classList.remove("shown");
      return;
    }
    if (current?.dataset.uri === uri) {
      return;
    }
    const next = backdrops.find(image => image !== current);
    next.dataset.uri = uri;
    next.src = uri;
    next
      .decode()
      .catch(() => {})
      .then(() => {
        if (token === backdropToken) {
          next.classList.add("shown");
          current?.classList.remove("shown");
        }
      });
  }

  function create(tag, className) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    return element;
  }

  function text(tag, l10nId, className, args) {
    const element = create(tag, className);
    document.l10n.setAttributes(element, l10nId, args);
    return element;
  }

  function button(l10nId, onClick, type = "default") {
    const element = document.createElement("moz-button");
    element.setAttribute("type", type);
    document.l10n.setAttributes(element, l10nId);
    element.addEventListener("click", onClick);
    return element;
  }

  function choiceCard(name, titleId, descriptionId, selected, onSelect) {
    const card = create("button", "komorebi-onb-choice");
    card.type = "button";
    card.dataset.choice = name;
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", selected);
    card.append(
      create("span", `komorebi-onb-schematic ${name}`),
      text("span", titleId, "komorebi-onb-choice-title"),
      text("span", descriptionId, "komorebi-onb-choice-description")
    );
    card.addEventListener("click", () => {
      for (const sibling of card.parentElement.children) {
        sibling.setAttribute("aria-checked", sibling === card);
      }
      onSelect();
    });
    return card;
  }

  function buildWelcome() {
    const step = create("div", "komorebi-onb-step centered");
    const logo = document.createElement("img");
    logo.className = "komorebi-onb-logo";
    logo.src = "chrome://branding/content/about-logo.svg";
    logo.alt = "";
    step.append(
      logo,
      text("h1", "komorebi-library-title", "komorebi-onb-title"),
      text("p", "komorebi-onb-welcome-line", "komorebi-onb-lead")
    );
    return step;
  }

  function buildWallpapers() {
    const step = create("div", "komorebi-onb-step");
    const title = text("h1", "komorebi-onb-wall-title", "komorebi-onb-title");
    const body = create("div", "komorebi-onb-wall-body");
    body.setAttribute("aria-busy", "true");
    body.appendChild(text("p", "komorebi-onb-wall-scanning", "komorebi-onb-lead"));
    step.append(title, body);

    const render = wallpapers => {
      body.removeAttribute("aria-busy");
      if (wallpapers.length) {
        body.replaceChildren(...buildWallpaperGrid(wallpapers, render));
      } else {
        body.replaceChildren(...buildWallpaperHelp(body, render));
      }
    };
    global.KomorebiLibrary.listWallpapers().then(render, error => {
      console.error("Komorebi could not list wallpapers", error);
      render([]);
    });
    return step;
  }

  function buildWallpaperGrid(wallpapers) {
    const library = global.KomorebiLibrary;
    const note = text("p", "komorebi-onb-wall-count", "komorebi-onb-lead", {
      count: wallpapers.length,
    });
    const grid = create("div", "komorebi-onb-wall-grid");
    for (const project of wallpapers.slice(0, MAX_WALLPAPERS)) {
      const item = create("button", "komorebi-onb-wall");
      item.type = "button";
      item.title = project.title;
      item.setAttribute("aria-label", project.title);
      item.classList.toggle(
        "selected",
        project.filePath === library.getCurrentFilePath()
      );
      if (project.previewPath) {
        const preview = document.createElement("img");
        preview.alt = "";
        preview.loading = "lazy";
        preview.decoding = "async";
        preview.src = library.toPreviewURI(project.previewPath);
        item.dataset.preview = preview.src;
        item.appendChild(preview);
        const previewItem = () => showBackdrop(item.dataset.preview);
        item.addEventListener("mouseenter", previewItem);
        item.addEventListener("focus", previewItem);
      }
      item.addEventListener("click", async () => {
        item.classList.add("loading");
        const applied = await library.applyWallpaper(project);
        item.classList.remove("loading");
        if (applied) {
          for (const other of grid.children) {
            other.classList.toggle("selected", other === item);
          }
        }
      });
      grid.appendChild(item);
    }
    const showSelected = () =>
      showBackdrop(grid.querySelector(".selected")?.dataset.preview);
    grid.addEventListener("mouseleave", showSelected);
    showSelected();
    const actions = create("div", "komorebi-onb-actions");
    actions.appendChild(button("komorebi-onb-wall-see-all", () => library.open()));
    return [note, grid, actions];
  }

  function buildWallpaperHelp(body, render) {
    const library = global.KomorebiLibrary;
    const opened = text("p", "komorebi-onb-wall-store-opened", "komorebi-onb-note");
    opened.hidden = true;
    const actions = create("div", "komorebi-onb-actions");
    actions.append(
      button(
        "komorebi-onb-wall-store",
        () => {
          openTrustedLinkIn(STORE_URL, "tab", { inBackground: true });
          opened.hidden = false;
        },
        "primary"
      ),
      button("komorebi-onb-wall-folder", async () => {
        await library.addFolder();
        render(library.getWallpapers());
      }),
      button("komorebi-onb-wall-recheck", async () =>
        render(await library.listWallpapers())
      )
    );
    return [
      text("h2", "komorebi-onb-wall-empty-title", "komorebi-onb-subtitle"),
      text("p", "komorebi-onb-wall-empty-text", "komorebi-onb-lead"),
      actions,
      opened,
      text("p", "komorebi-onb-wall-skip-note", "komorebi-onb-note"),
    ];
  }

  function newImportState(sources) {
    const state = { chromeJob: null, firefoxQueued: false, sources };
    for (const key of IMPORT_SOURCES) {
      state[key] = {
        enabled: Boolean(sources[key]),
        profile: sources[key]?.defaultId,
      };
    }
    return state;
  }

  function buildImportSource(key) {
    const source = importState.sources[key];
    const choice = importState[key];
    const item = create("div", "komorebi-onb-source");
    const label = create("label", "komorebi-onb-source-label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = choice.enabled;
    checkbox.addEventListener("change", () => {
      choice.enabled = checkbox.checked;
      item.classList.toggle("off", !checkbox.checked);
    });
    const name = create("span", "komorebi-onb-source-text");
    name.append(
      text("strong", `komorebi-onb-import-${key}`, "komorebi-onb-source-name"),
      text("span", `komorebi-onb-import-${key}-description`, "komorebi-onb-note")
    );
    label.append(checkbox, name);
    item.appendChild(label);

    if (source.profiles.length > 1) {
      const select = document.createElement("select");
      select.className = "komorebi-onb-source-profile";
      document.l10n.setAttributes(select, "komorebi-onb-import-profile");
      for (const profile of source.profiles) {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profile.name;
        select.appendChild(option);
      }
      select.value = choice.profile;
      select.addEventListener("change", () => {
        choice.profile = select.value;
      });
      item.appendChild(select);
    }
    if (source.running) {
      item.appendChild(
        text("p", `komorebi-onb-import-${key}-open`, "komorebi-onb-source-warning")
      );
    }
    return item;
  }

  function buildImport() {
    const step = create("div", "komorebi-onb-step");
    const list = create("div", "komorebi-onb-sources");
    for (const key of IMPORT_SOURCES) {
      if (importState.sources[key]) {
        list.appendChild(buildImportSource(key));
      }
    }
    step.append(
      text("h1", "komorebi-onb-import-title", "komorebi-onb-title"),
      text("p", "komorebi-onb-import-lead", "komorebi-onb-lead"),
      list,
      text("p", "komorebi-onb-import-note", "komorebi-onb-note")
    );
    return step;
  }

  // Runs when the user confirms the import step. Chrome copies in the
  // background; Firefox waits for the restart that ends the introduction.
  function startImports() {
    const chrome = importState.chrome;
    if (
      chrome.enabled &&
      importState.sources.chrome &&
      importState.chromeJob?.profile !== chrome.profile
    ) {
      const job = { profile: chrome.profile, state: "running" };
      importState.chromeJob = job;
      const profile = importState.sources.chrome.profiles.find(
        item => item.id === chrome.profile
      );
      job.promise = global.KomorebiImport.importFromChrome(profile).then(
        counts => {
          job.state = "done";
          job.counts = counts;
        },
        error => {
          console.error("Komorebi could not import from Chrome", error);
          job.state = "failed";
        }
      );
    }
    importState.firefoxQueued =
      importState.firefox.enabled && Boolean(importState.sources.firefox);
  }

  function importStatusLines() {
    const lines = [];
    const job = importState?.chromeJob;
    if (job) {
      lines.push(`komorebi-onb-import-chrome-${job.state}`);
    }
    if (importState?.firefoxQueued) {
      lines.push("komorebi-onb-import-firefox-pending");
    }
    return lines;
  }

  function renderImportStatus(container) {
    const draw = () =>
      container.replaceChildren(
        ...importStatusLines().map(id => text("p", id, "komorebi-onb-note"))
      );
    draw();
    // The copy may still be running: draw again once it has settled.
    importState?.chromeJob?.promise?.then(() => {
      if (container.isConnected) {
        draw();
      }
    });
  }

  async function finishImports() {
    const restart = importState?.firefoxQueued;
    await Promise.race([
      importState?.chromeJob?.promise,
      new Promise(resolve => window.setTimeout(resolve, IMPORT_WAIT_MS)),
    ]);
    if (restart) {
      global.KomorebiImport.restartIntoFirefoxImport();
    }
  }

  function buildLayout() {
    const step = create("div", "komorebi-onb-step");
    const vertical = Services.prefs.getBoolPref(VERTICAL_PREF, false);
    const choices = create("div", "komorebi-onb-choices");
    choices.setAttribute("role", "radiogroup");
    choices.append(
      choiceCard("top", "komorebi-onb-layout-top", "komorebi-onb-layout-top-description", !vertical, () =>
        Services.prefs.setBoolPref(VERTICAL_PREF, false)
      ),
      choiceCard("side", "komorebi-onb-layout-side", "komorebi-onb-layout-side-description", vertical, () => {
        Services.prefs.setBoolPref(REVAMP_PREF, true);
        Services.prefs.setBoolPref(VERTICAL_PREF, true);
      })
    );
    const compact = document.createElement("moz-toggle");
    document.l10n.setAttributes(compact, "komorebi-compact-mode");
    compact.pressed = Services.prefs.getBoolPref(COMPACT_PREF, false);
    compact.addEventListener("toggle", () =>
      Services.prefs.setBoolPref(COMPACT_PREF, compact.pressed)
    );
    step.append(
      text("h1", "komorebi-onb-layout-title", "komorebi-onb-title"),
      choices,
      compact
    );
    return step;
  }

  function buildSearch() {
    const step = create("div", "komorebi-onb-step");
    const list = create("div", "komorebi-onb-engines");
    list.setAttribute("role", "radiogroup");
    step.append(text("h1", "komorebi-onb-search-title", "komorebi-onb-title"), list);

    Promise.all([
      lazy.SearchService.getVisibleEngines(),
      lazy.SearchService.getDefault(),
    ]).then(([engines, current]) => {
      for (const engine of engines) {
        if (engine.alias?.startsWith("!")) {
          continue;
        }
        const item = create("button", "komorebi-onb-engine");
        item.type = "button";
        item.setAttribute("role", "radio");
        item.setAttribute("aria-checked", engine.id === current.id);
        item.textContent = engine.name;
        item.addEventListener("click", async () => {
          await lazy.SearchService.setDefault(
            engine,
            lazy.SearchService.CHANGE_REASON.USER
          );
          for (const other of list.children) {
            other.setAttribute("aria-checked", other === item);
          }
        });
        list.appendChild(item);
      }
    }, error => console.error("Komorebi could not list search engines", error));
    return step;
  }

  async function installUBlock(installButton) {
    if (ublockState === "installing" || ublockState === "installed") {
      return;
    }
    const setState = state => {
      ublockState = state;
      installButton.toggleAttribute("disabled", state !== "idle" && state !== "failed");
      document.l10n.setAttributes(
        installButton,
        state === "idle" ? "komorebi-onb-ublock" : `komorebi-onb-ublock-${state}`
      );
    };
    setState("installing");
    try {
      const install = await lazy.AddonManager.getInstallForURL(UBLOCK_URL, {
        telemetryInfo: { source: "komorebi-onboarding" },
      });
      if (!install) {
        throw new Error("No install object for uBlock Origin");
      }
      await install.install();
      setState("installed");
    } catch (error) {
      console.error("Komorebi could not install uBlock Origin", error);
      setState("failed");
    }
  }

  function buildPrivacy() {
    const step = create("div", "komorebi-onb-step");
    const fingerprint = document.createElement("moz-toggle");
    document.l10n.setAttributes(fingerprint, "komorebi-onb-fingerprint");
    fingerprint.pressed = Services.prefs.getBoolPref(FINGERPRINT_PREF, true);
    fingerprint.addEventListener("toggle", () =>
      Services.prefs.setBoolPref(FINGERPRINT_PREF, fingerprint.pressed)
    );
    const installButton = button("komorebi-onb-ublock", () =>
      installUBlock(installButton)
    );
    if (ublockState !== "idle") {
      document.l10n.setAttributes(installButton, `komorebi-onb-ublock-${ublockState}`);
      installButton.toggleAttribute("disabled", ublockState !== "failed");
    }
    step.append(
      text("h1", "komorebi-onb-privacy-title", "komorebi-onb-title"),
      fingerprint,
      installButton
    );
    return step;
  }

  function buildDone() {
    const step = create("div", "komorebi-onb-step centered");
    const actions = create("div", "komorebi-onb-actions");
    actions.appendChild(
      button("komorebi-onb-choose-wallpaper", () => {
        complete();
        global.KomorebiLibrary.open();
      })
    );
    const status = create("div", "komorebi-onb-import-status");
    status.setAttribute("aria-live", "polite");
    renderImportStatus(status);
    step.append(
      text("h1", "komorebi-onb-done-title", "komorebi-onb-title"),
      text("p", "komorebi-onb-done-text", "komorebi-onb-lead"),
      status,
      actions
    );
    return step;
  }

  const BUILDERS = {
    welcome: buildWelcome,
    import: buildImport,
    wallpapers: buildWallpapers,
    layout: buildLayout,
    search: buildSearch,
    privacy: buildPrivacy,
    done: buildDone,
  };

  function showStep(next, direction = 1) {
    index = next;
    const step = BUILDERS[steps[index]]();
    step.dataset.direction = direction > 0 ? "forward" : "back";
    stage.replaceChildren(step);
    dots.forEach((dot, dotIndex) => {
      dot.classList.toggle("active", dotIndex === index);
      dot.classList.toggle("done", dotIndex < index);
    });
    const last = index === steps.length - 1;
    backButton.hidden = index === 0;
    skipButton.hidden = last;
    document.l10n.setAttributes(
      nextButton,
      last
        ? importState?.firefoxQueued
          ? "komorebi-onb-finish-restart"
          : "komorebi-onb-finish"
        : index === 0
          ? "komorebi-onb-start"
          : "komorebi-onb-next"
    );
    dialog.dataset.step = steps[index];
    const heading = step.querySelector("h1");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }

  function complete() {
    if (finished) {
      return;
    }
    finished = true;
    Services.prefs.setBoolPref(ONBOARDED_PREF, true);
    const closing = dialog;
    closing?.classList.add("closing");
    window.setTimeout(() => closing?.close(), CLOSE_DELAY_MS);
    finishImports().catch(error =>
      console.error("Komorebi could not finish the import", error)
    );
  }

  async function showButtonHint() {
    try {
      if (
        Services.prefs.getBoolPref(BUTTON_HINT_PREF, false) ||
        document.documentElement.hasAttribute("komorebi-compact") ||
        document.getElementById("komorebi-library-dialog")?.open ||
        !CustomizableUI.getPlacementOfWidget(TOOLBAR_BUTTON_ID)
      ) {
        return;
      }
      const anchor = CustomizableUI.getWidget(TOOLBAR_BUTTON_ID).forWindow(
        window
      )?.anchor;
      if (!anchor || !anchor.getBoundingClientRect().width) {
        return;
      }
      const panel = document.createXULElement("panel");
      panel.id = "komorebi-button-hint";
      panel.setAttribute("type", "arrow");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("noautofocus", "true");
      const body = create("div", "komorebi-hint");
      const title = text("h2", "komorebi-hint-title", "komorebi-hint-title");
      title.id = "komorebi-hint-title";
      panel.setAttribute("aria-labelledby", title.id);
      body.append(
        title,
        text("p", "komorebi-hint-text", "komorebi-hint-text"),
        button("komorebi-hint-dismiss", () => panel.hidePopup(), "primary")
      );
      panel.appendChild(body);
      panel.addEventListener("popuphidden", () => panel.remove(), {
        once: true,
      });
      global.MozXULElement.insertFTLIfNeeded("browser/komorebi.ftl");
      document.getElementById("mainPopupSet").appendChild(panel);
      await document.l10n.translateFragment(body);
      Services.prefs.setBoolPref(BUTTON_HINT_PREF, true);
      panel.openPopup(anchor, "bottomcenter topright");
    } catch (error) {
      console.error("Komorebi could not show the button hint", error);
    }
  }

  function createDialog() {
    dialog = document.createElement("dialog");
    dialog.id = "komorebi-onboarding";
    document.l10n.setAttributes(dialog, "komorebi-onb-dialog");
    dialog.addEventListener("close", () => {
      Services.prefs.setBoolPref(ONBOARDED_PREF, true);
      dialog.remove();
      dialog = null;
      backdrops = [];
      window.setTimeout(showButtonHint, HINT_DELAY_MS);
    });

    backdrops = [0, 1].map(() => {
      const image = document.createElement("img");
      image.className = "komorebi-onb-backdrop";
      image.alt = "";
      return image;
    });

    stage = create("main", "komorebi-onb-stage");
    stage.setAttribute("aria-live", "polite");

    skipButton = button("komorebi-onb-skip", complete, "ghost");

    const dotList = create("div", "komorebi-onb-dots");
    document.l10n.setAttributes(dotList, "komorebi-onb-progress");
    dots = steps.map(() => create("span", "komorebi-onb-dot"));
    dotList.append(...dots);

    backButton = button("komorebi-onb-back", () => showStep(index - 1, -1));
    nextButton = button(
      "komorebi-onb-next",
      () => {
        if (index === steps.length - 1) {
          complete();
          return;
        }
        if (steps[index] === "import") {
          startImports();
        }
        showStep(index + 1);
      },
      "primary"
    );
    const footer = create("footer", "komorebi-onb-footer");
    const nav = create("div", "komorebi-onb-nav");
    nav.append(backButton, nextButton);
    footer.append(skipButton, dotList, nav);

    dialog.append(
      ...backdrops,
      create("div", "komorebi-onb-scrim"),
      stage,
      footer
    );
    document.body.appendChild(dialog);
  }

  async function open() {
    global.MozXULElement.insertFTLIfNeeded("browser/komorebi.ftl");
    if (dialog || opening) {
      return;
    }
    opening = true;
    try {
      importState = newImportState(await global.KomorebiImport.detect());
    } catch (error) {
      console.error("Komorebi could not look for browsers to import", error);
      importState = newImportState({});
    }
    opening = false;
    steps = STEPS.filter(
      name =>
        name !== "import" ||
        IMPORT_SOURCES.some(key => importState.sources[key])
    );
    finished = false;
    ublockState = "idle";
    createDialog();
    dialog.showModal();
    showStep(0);
  }

  function isEligible() {
    return (
      !Services.prefs.getBoolPref(ONBOARDED_PREF, false) &&
      window.toolbar.visible &&
      !window.browsingContext.usePrivateBrowsing &&
      Services.wm.getMostRecentBrowserWindow() === window
    );
  }

  async function init() {
    if (Services.prefs.getBoolPref(ONBOARDED_PREF, false)) {
      return;
    }
    await window.delayedStartupPromise;
    await new Promise(resolve =>
      window.requestIdleCallback(resolve, { timeout: 2000 })
    );
    if (isEligible()) {
      open();
    }
  }

  global.KomorebiOnboarding = { init, open };
})(this);
