/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* globals gBrowser, TabContextMenu */

(function (global) {
  "use strict";

  const SPACES_PREF = "browser.komorebi.spaces";
  const PLACED_PREF = "browser.komorebi.spacesButtonPlaced";
  const TAB_KEY = "komorebi-space";
  const WINDOW_KEY = "komorebi-active-space";
  const HIDDEN_BY = "komorebi-spaces";
  const WIDGET_ID = "komorebi-spaces-button";
  const MENU_ID = "komorebi-spaces-menu";
  const MOVE_MENU_ID = "komorebi-move-to-space";
  const COLORS = [
    "#7c6cf0",
    "#2fa7a0",
    "#e0884b",
    "#d6577a",
    "#5b9be0",
    "#8fb04a",
  ];

  function readSpaces() {
    try {
      const spaces = JSON.parse(Services.prefs.getStringPref(SPACES_PREF, ""));
      if (
        Array.isArray(spaces) &&
        spaces.length &&
        spaces.every(space => space?.id && typeof space.name === "string")
      ) {
        return spaces;
      }
    } catch (error) {}
    return null;
  }

  function writeSpaces(spaces) {
    Services.prefs.setStringPref(SPACES_PREF, JSON.stringify(spaces));
  }

  function dotImage(color) {
    return `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="5" fill="${color}"/></svg>`
    )}`;
  }

  function buildButton(doc) {
    const button = doc.createXULElement("toolbarbutton");
    button.id = WIDGET_ID;
    button.setAttribute("type", "menu");
    button.setAttribute("wantdropmarker", "false");
    button.className = "toolbarbutton-1 chromeclass-toolbar-additional";
    const popup = doc.createXULElement("menupopup");
    popup.id = MENU_ID;
    button.appendChild(popup);
    return button;
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
        type: "custom",
        defaultArea: CustomizableUI.AREA_TABSTRIP,
        l10nId: "komorebi-spaces-button",
        onBuild: buildButton,
        onCreated(node) {
          node.ownerDocument.defaultView.KomorebiSpaces?.updateButton();
        },
      });
      if (!Services.prefs.getBoolPref(PLACED_PREF, false)) {
        Services.prefs.setBoolPref(PLACED_PREF, true);
        if (!CustomizableUI.getPlacementOfWidget(WIDGET_ID, false, true)) {
          CustomizableUI.addWidgetToArea(
            WIDGET_ID,
            CustomizableUI.AREA_TABSTRIP,
            0
          );
        }
      }
    } catch (error) {
      console.error("Komorebi could not register the spaces button", error);
    }
  }

  let started = false;
  let activeId = null;

  async function ensureDefaultSpace() {
    if (readSpaces()) {
      return;
    }
    const name = await document.l10n.formatValue("komorebi-space-default-name");
    writeSpaces([{ id: "space-1", name, color: COLORS[0] }]);
  }

  function spaces() {
    return readSpaces() || [{ id: "space-1", name: "", color: COLORS[0] }];
  }

  function getSpace(id) {
    return spaces().find(space => space.id === id) || spaces()[0];
  }

  function spaceOf(tab) {
    return getSpace(SessionStore.getCustomTabValue(tab, TAB_KEY)).id;
  }

  function isManageable(tab) {
    return !tab.closing && tab !== window.FirefoxViewHandler?.tab;
  }

  function tabsOfSpace(id) {
    return [...gBrowser.tabs].filter(
      tab => isManageable(tab) && !tab.pinned && spaceOf(tab) === id
    );
  }

  function setActive(id) {
    activeId = getSpace(id).id;
    SessionStore.setCustomWindowValue(window, WINDOW_KEY, activeId);
  }

  function applyVisibility() {
    for (const tab of gBrowser.tabs) {
      if (!isManageable(tab)) {
        continue;
      }
      if (tab.pinned || spaceOf(tab) === activeId) {
        const hiddenBy = SessionStore.getCustomTabValue(tab, "hiddenBy");
        if (tab.hidden && (!hiddenBy || hiddenBy === HIDDEN_BY)) {
          gBrowser.showTab(tab);
        }
      } else {
        gBrowser.hideTab(tab, HIDDEN_BY);
      }
    }
  }

  function updateButton() {
    const button = document.getElementById(WIDGET_ID);
    if (!button) {
      return;
    }
    const space = getSpace(activeId);
    button.setAttribute("label", space.name);
    button.setAttribute("tooltiptext", space.name);
    button.style.listStyleImage = `url("${dotImage(space.color)}")`;
  }

  function refresh() {
    setActive(activeId);
    applyVisibility();
    updateButton();
  }

  function switchTo(id) {
    const target = getSpace(id).id;
    const selected = gBrowser.selectedTab;
    const alreadyThere =
      !selected.pinned && spaceOf(selected) === target && activeId === target;
    setActive(target);
    if (!alreadyThere) {
      const candidates = tabsOfSpace(target);
      if (candidates.length) {
        gBrowser.selectedTab = candidates.reduce((best, tab) =>
          tab.lastAccessed > best.lastAccessed ? tab : best
        );
      } else {
        gBrowser.selectedTab = gBrowser.addTrustedTab("about:newtab");
      }
    }
    applyVisibility();
    updateButton();
  }

  function assignTab(tab, id) {
    SessionStore.setCustomTabValue(tab, TAB_KEY, id);
    if (tab.selected) {
      setActive(id);
    }
  }

  function moveTabsToSpace(tabs, id) {
    for (const tab of tabs) {
      assignTab(tab, id);
    }
    applyVisibility();
    updateButton();
  }

  async function promptName(titleId, initial) {
    const [title, text] = await document.l10n.formatValues([
      titleId,
      "komorebi-space-name-prompt",
    ]);
    const value = { value: initial };
    const accepted = Services.prompt.prompt(
      window,
      title,
      text,
      value,
      null,
      {}
    );
    const name = value.value.trim();
    return accepted && name ? name : null;
  }

  async function createSpace() {
    const name = await promptName("komorebi-space-new-title", "");
    if (!name) {
      return;
    }
    const list = spaces();
    const id = `space-${Date.now().toString(36)}`;
    list.push({ id, name, color: COLORS[list.length % COLORS.length] });
    writeSpaces(list);
    switchTo(id);
  }

  async function renameSpace(id) {
    const name = await promptName(
      "komorebi-space-rename-title",
      getSpace(id).name
    );
    if (!name) {
      return;
    }
    writeSpaces(spaces().map(s => (s.id === id ? { ...s, name } : s)));
  }

  async function deleteSpace(id) {
    const list = spaces();
    if (list.length < 2) {
      return;
    }
    const [title, text] = await document.l10n.formatValues([
      "komorebi-space-delete-title",
      "komorebi-space-delete-text",
    ]);
    if (!Services.prompt.confirm(window, title, text)) {
      return;
    }
    const first = list[0].id === id ? list[1].id : list[0].id;
    for (const tab of gBrowser.tabs) {
      if (spaceOf(tab) === id) {
        SessionStore.setCustomTabValue(tab, TAB_KEY, first);
      }
    }
    writeSpaces(list.filter(space => space.id !== id));
    if (activeId === id) {
      setActive(first);
    }
    applyVisibility();
    updateButton();
  }

  function menuItem(l10nId, onCommand, disabled = false) {
    const item = document.createXULElement("menuitem");
    document.l10n.setAttributes(item, l10nId);
    item.toggleAttribute("disabled", disabled);
    item.addEventListener("command", onCommand);
    return item;
  }

  function fillSpacesMenu(popup) {
    const list = spaces();
    const items = list.map(space => {
      const item = document.createXULElement("menuitem");
      item.setAttribute("type", "radio");
      item.setAttribute("name", "komorebi-space");
      item.setAttribute("label", space.name);
      item.setAttribute("image", dotImage(space.color));
      item.classList.add("menuitem-iconic");
      item.toggleAttribute("checked", space.id === activeId);
      item.addEventListener("command", () => switchTo(space.id));
      return item;
    });
    popup.replaceChildren(
      ...items,
      document.createXULElement("menuseparator"),
      menuItem("komorebi-space-new", createSpace),
      menuItem("komorebi-space-rename", () => renameSpace(activeId)),
      menuItem("komorebi-space-delete", () => deleteSpace(activeId), list.length < 2)
    );
  }

  function fillMoveMenu(popup) {
    const tab = TabContextMenu.contextTab;
    const tabs = tab.multiselected ? gBrowser.selectedTabs : [tab];
    popup.replaceChildren(
      ...spaces().map(space => {
        const item = document.createXULElement("menuitem");
        item.setAttribute("label", space.name);
        item.setAttribute("image", dotImage(space.color));
        item.classList.add("menuitem-iconic");
        item.addEventListener("command", () => moveTabsToSpace(tabs, space.id));
        return item;
      })
    );
  }

  function createTabContextMenu() {
    const menu = document.createXULElement("menu");
    menu.id = MOVE_MENU_ID;
    document.l10n.setAttributes(menu, "komorebi-move-to-space");
    const popup = document.createXULElement("menupopup");
    menu.appendChild(popup);
    popup.addEventListener("popupshowing", event => {
      event.stopPropagation();
      fillMoveMenu(popup);
    });
    return menu;
  }

  function placeTabContextMenu() {
    const anchor = document.getElementById("context_moveTabOptions");
    anchor?.after(
      document.getElementById(MOVE_MENU_ID) || createTabContextMenu()
    );
  }

  function addShortcuts() {
    const keyset = document.getElementById("mainKeyset");
    for (let number = 1; number <= 9; number++) {
      const key = document.createXULElement("key");
      key.id = `komorebi-key-space-${number}`;
      key.setAttribute("key", String(number));
      key.setAttribute("modifiers", "control,alt");
      key.addEventListener("command", () => {
        const space = spaces()[number - 1];
        if (space) {
          switchTo(space.id);
        }
      });
      keyset.appendChild(key);
    }
  }

  function onTabOpen(event) {
    const tab = event.target;
    if (!SessionStore.getCustomTabValue(tab, TAB_KEY)) {
      SessionStore.setCustomTabValue(tab, TAB_KEY, activeId);
    }
  }

  function onTabSelect() {
    const tab = gBrowser.selectedTab;
    if (tab.pinned || !isManageable(tab) || spaceOf(tab) === activeId) {
      return;
    }
    setActive(spaceOf(tab));
    applyVisibility();
    updateButton();
  }

  function onTabRestoring(event) {
    const tab = event.target;
    if (!tab.selected && !tab.pinned && spaceOf(tab) !== activeId) {
      gBrowser.hideTab(tab, HIDDEN_BY);
    }
  }

  function onWindowRestored() {
    const saved = SessionStore.getCustomWindowValue(window, WINDOW_KEY);
    const selected = gBrowser.selectedTab;
    setActive(selected.pinned ? saved || activeId : spaceOf(selected));
    applyVisibility();
    updateButton();
  }

  async function init() {
    if (started) {
      return;
    }
    started = true;
    global.MozXULElement.insertFTLIfNeeded("browser/komorebi.ftl");
    await ensureDefaultSpace();
    registerWidget();
    await window.delayedStartupPromise;
    await SessionStore.promiseAllWindowsRestored;

    const saved = SessionStore.getCustomWindowValue(window, WINDOW_KEY);
    activeId = getSpace(saved || spaceOf(gBrowser.selectedTab)).id;

    document.addEventListener(
      "popupshowing",
      event => {
        if (event.target.id === MENU_ID) {
          fillSpacesMenu(event.target);
        }
      },
      true
    );

    document.addEventListener("popupshowing", event => {
      if (event.target.id === "tabContextMenu") {
        placeTabContextMenu();
      }
    });
    addShortcuts();

    const container = gBrowser.tabContainer;
    container.addEventListener("TabOpen", onTabOpen);
    container.addEventListener("TabSelect", onTabSelect);
    container.addEventListener("SSTabRestoring", onTabRestoring);
    window.addEventListener("SSWindowRestored", onWindowRestored);

    const prefObserver = { observe: refresh };
    Services.prefs.addObserver(SPACES_PREF, prefObserver);
    window.addEventListener(
      "unload",
      () => Services.prefs.removeObserver(SPACES_PREF, prefObserver),
      { once: true }
    );

    for (const tab of gBrowser.tabs) {
      if (!SessionStore.getCustomTabValue(tab, TAB_KEY) && isManageable(tab)) {
        SessionStore.setCustomTabValue(tab, TAB_KEY, activeId);
      }
    }
    refresh();
  }

  global.KomorebiSpaces = {
    init,
    updateButton,
    switchTo,
    getActiveSpace: () => getSpace(activeId),
    getSpaces: spaces,
  };
})(this);
