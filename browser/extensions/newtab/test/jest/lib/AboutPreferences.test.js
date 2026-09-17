/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  AboutPreferences,
  PREFERENCES_LOADED_EVENT,
  PREFERENCES_LOADED_EVENT_SUBPANE,
} from "lib/AboutPreferences.sys.mjs";
import { actionTypes as at } from "common/Actions.mjs";
import { mockServices, stubGlobals } from "test/jest/test-utils";

describe("AboutPreferences Feed", () => {
  let restoreGlobals;
  let fakeServices;
  let instance;

  // sinon's `.withArgs(pref, false).returns(value)` becomes a lookup table:
  // any pref that isn't listed reads back as undefined.
  const setBoolPrefs = prefs => {
    fakeServices.prefs.getBoolPref.mockImplementation(pref => prefs[pref]);
  };

  beforeEach(() => {
    instance = new AboutPreferences();
    instance.store = {
      getState: () => ({}),
    };
    fakeServices = mockServices(["obs", "prefs"]);
    restoreGlobals = stubGlobals({
      Services: fakeServices,
    });
  });
  afterEach(() => {
    restoreGlobals();
    jest.restoreAllMocks();
  });

  describe("#onAction", () => {
    it("should call .init() on an INIT action", () => {
      const stub = jest.spyOn(instance, "init").mockImplementation(() => {});

      instance.onAction({ type: at.INIT });

      expect(stub).toHaveBeenCalledTimes(1);
    });
    it("should call .uninit() on an UNINIT action", () => {
      const stub = jest.spyOn(instance, "uninit").mockImplementation(() => {});

      instance.onAction({ type: at.UNINIT });

      expect(stub).toHaveBeenCalledTimes(1);
    });
    it("should call .openPreferences on SETTINGS_OPEN", () => {
      const action = {
        type: at.SETTINGS_OPEN,
        _target: {
          window: { openPreferences: jest.fn() },
        },
      };
      instance.onAction(action);
      expect(action._target.window.openPreferences).toHaveBeenCalledTimes(1);
    });
    it("should call .BrowserAddonUI.openAddonsMgr with the extension id on OPEN_WEBEXT_SETTINGS", () => {
      const action = {
        type: at.OPEN_WEBEXT_SETTINGS,
        data: "foo",
        _target: {
          window: {
            BrowserAddonUI: { openAddonsMgr: jest.fn() },
          },
        },
      };
      instance.onAction(action);
      expect(
        action._target.window.BrowserAddonUI.openAddonsMgr
      ).toHaveBeenCalledWith("addons://detail/foo");
    });
  });

  describe("#observe", () => {
    let restoreObserveGlobals;
    let registerGroups;
    let getSettingGroup;
    let insertFTLIfNeeded;

    beforeEach(() => {
      registerGroups = jest.fn();
      let homeCalls = 0;
      getSettingGroup = jest.fn(group => {
        if (group !== "home") {
          return undefined;
        }
        homeCalls += 1;
        if (homeCalls === 1) {
          throw new Error("Not yet registered");
        }
        return true;
      });
      insertFTLIfNeeded = jest.fn();
      restoreObserveGlobals = stubGlobals({
        SettingGroupManager: {
          registerGroups,
          get: getSettingGroup,
        },
        MozXULElement: { insertFTLIfNeeded },
      });
      jest.spyOn(instance, "_registerPreferences").mockImplementation();
      jest.spyOn(instance, "_setupHomeGroup").mockReturnValue({});
    });

    afterEach(() => {
      restoreObserveGlobals();
    });

    it("should watch for about:preferences loading", () => {
      instance.init();

      expect(fakeServices.obs.addObserver).toHaveBeenCalledTimes(2);
      expect(fakeServices.obs.addObserver).toHaveBeenCalledWith(
        instance,
        PREFERENCES_LOADED_EVENT
      );
      expect(fakeServices.obs.addObserver).toHaveBeenCalledWith(
        instance,
        PREFERENCES_LOADED_EVENT_SUBPANE
      );
    });
    it("should stop watching on uninit", () => {
      instance.uninit();

      expect(fakeServices.obs.removeObserver).toHaveBeenCalledTimes(2);
      expect(fakeServices.obs.removeObserver).toHaveBeenCalledWith(
        instance,
        PREFERENCES_LOADED_EVENT
      );
      expect(fakeServices.obs.removeObserver).toHaveBeenCalledWith(
        instance,
        PREFERENCES_LOADED_EVENT_SUBPANE
      );
    });
    it("should register newtab.ftl with the preferences document", () => {
      instance.observe(window);

      expect(insertFTLIfNeeded).toHaveBeenCalledWith(
        "browser/newtab/newtab.ftl"
      );
    });

    it("should call registerGroups with home only", async () => {
      // homepage/customHomepage are owned by components/preferences.
      await instance.observe(window);

      expect(registerGroups).toHaveBeenCalledTimes(1);
      const [[groups]] = registerGroups.mock.calls;
      expect(Object.keys(groups)).toEqual(["home"]);
      expect(groups).not.toHaveProperty("homepage");
      expect(groups).not.toHaveProperty("customHomepage");
    });

    it("should not register a second time when observe fires again for the same window", async () => {
      await instance.observe(window, PREFERENCES_LOADED_EVENT);
      await instance.observe(window, PREFERENCES_LOADED_EVENT_SUBPANE);

      expect(instance._registerPreferences).toHaveBeenCalledTimes(1);
      expect(registerGroups).toHaveBeenCalledTimes(1);
    });
  });

  describe("#_registerPreferences", () => {
    it("should call Preferences.addAll once with all pref ids", () => {
      const addAll = jest.fn();

      instance._registerPreferences({ Preferences: { addAll } });

      expect(addAll).toHaveBeenCalledTimes(1);
      // Spot-check prefs from the beginning, middle, and end of the list.
      const [[prefs]] = addAll.mock.calls;
      expect(Array.isArray(prefs)).toBe(true);
      expect(
        prefs.some(
          p => p.id === "browser.newtabpage.activity-stream.showSearch"
        )
      ).toBe(true);
      expect(
        prefs.some(
          p => p.id === "browser.newtabpage.activity-stream.feeds.topsites"
        )
      ).toBe(true);
      expect(
        prefs.some(
          p =>
            p.id ===
            "browser.newtabpage.activity-stream.section.highlights.includeVisited"
        )
      ).toBe(true);
      expect(
        prefs.some(
          p =>
            p.id === "browser.newtabpage.activity-stream.hideLogo" &&
            p.type === "bool" &&
            p.inverted === true
        )
      ).toBe(true);
    });
  });

  describe("#_setupHomeGroup", () => {
    let addSetting;
    let Preferences;

    beforeEach(() => {
      addSetting = jest.fn();
      Preferences = { addSetting };
    });

    it("should register weather against showWeather prefs when Nova is disabled", () => {
      setBoolPrefs({
        "browser.newtabpage.activity-stream.nova.enabled": false,
      });

      instance._setupHomeGroup({ Preferences });

      const calls = addSetting.mock.calls.map(([{ id, pref }]) => ({
        id,
        pref,
      }));
      expect(
        calls.some(
          c =>
            c.id === "weather" &&
            c.pref === "browser.newtabpage.activity-stream.showWeather"
        )
      ).toBe(true);
      expect(
        calls.some(
          c =>
            c.pref ===
            "browser.newtabpage.activity-stream.widgets.weather.enabled"
        )
      ).toBe(false);
    });

    it("should register weather against widgets.weather.enabled when Nova is enabled", () => {
      setBoolPrefs({ "browser.newtabpage.activity-stream.nova.enabled": true });

      instance._setupHomeGroup({ Preferences });

      const calls = addSetting.mock.calls.map(([{ id, pref }]) => ({
        id,
        pref,
      }));
      expect(
        calls.some(
          c =>
            c.id === "weather" &&
            c.pref ===
              "browser.newtabpage.activity-stream.widgets.weather.enabled"
        )
      ).toBe(true);
      expect(
        calls.some(
          c => c.pref === "browser.newtabpage.activity-stream.showWeather"
        )
      ).toBe(false);
    });

    const findSetting = id =>
      addSetting.mock.calls.find(([s]) => s.id === id)[0];

    it("shows a widget toggle when the widget is enabled via trainhopConfig even if its system pref is off", () => {
      fakeServices.prefs.getBoolPref.mockReturnValue(false);
      instance.store.getState = () => ({
        Prefs: {
          values: { trainhopConfig: { widgets: { listsEnabled: true } } },
        },
      });

      instance._setupHomeGroup({ Preferences });

      expect(
        findSetting("lists").visible({ listsEnabled: { value: false } })
      ).toBe(true);
    });

    it("shows a widget toggle when its system pref is on (read live from deps)", () => {
      fakeServices.prefs.getBoolPref.mockReturnValue(false);
      instance.store.getState = () => ({ Prefs: { values: {} } });

      instance._setupHomeGroup({ Preferences });

      expect(
        findSetting("lists").visible({ listsEnabled: { value: true } })
      ).toBe(true);
    });

    it("hides a widget toggle when neither the system pref nor trainhopConfig enable it", () => {
      fakeServices.prefs.getBoolPref.mockReturnValue(false);
      instance.store.getState = () => ({ Prefs: { values: {} } });

      instance._setupHomeGroup({ Preferences });

      expect(
        findSetting("lists").visible({ listsEnabled: { value: false } })
      ).toBe(false);
    });

    it("shows a widget toggle when revealed via widgetsSettings even if its system pref is off", () => {
      fakeServices.prefs.getBoolPref.mockReturnValue(false);
      instance.store.getState = () => ({
        Prefs: {
          values: {
            trainhopConfig: { widgetsSettings: { listsVisible: true } },
          },
        },
      });

      instance._setupHomeGroup({ Preferences });

      expect(
        findSetting("lists").visible({ listsEnabled: { value: false } })
      ).toBe(true);
    });

    it("shows the widgets group when the container is enabled via trainhopConfig even if the system pref is off", () => {
      fakeServices.prefs.getBoolPref.mockReturnValue(false);
      instance.store.getState = () => ({
        Prefs: { values: { trainhopConfig: { widgets: { enabled: true } } } },
      });

      instance._setupHomeGroup({ Preferences });

      expect(
        findSetting("widgets").visible({ widgetsEnabled: { value: false } })
      ).toBe(true);
    });

    it("shows the widgets group when the container system pref is on (read live from deps)", () => {
      fakeServices.prefs.getBoolPref.mockReturnValue(false);
      instance.store.getState = () => ({ Prefs: { values: {} } });

      instance._setupHomeGroup({ Preferences });

      expect(
        findSetting("widgets").visible({ widgetsEnabled: { value: true } })
      ).toBe(true);
    });

    it("hides the widgets group when neither the system pref nor trainhopConfig enable the container", () => {
      fakeServices.prefs.getBoolPref.mockReturnValue(false);
      instance.store.getState = () => ({ Prefs: { values: {} } });

      instance._setupHomeGroup({ Preferences });

      expect(
        findSetting("widgets").visible({ widgetsEnabled: { value: false } })
      ).toBe(false);
    });

    it("shows the widgets group when revealed via widgetsSettings even if the system pref is off", () => {
      fakeServices.prefs.getBoolPref.mockReturnValue(false);
      instance.store.getState = () => ({
        Prefs: {
          values: { trainhopConfig: { widgetsSettings: { enabled: true } } },
        },
      });

      instance._setupHomeGroup({ Preferences });

      expect(
        findSetting("widgets").visible({ widgetsEnabled: { value: false } })
      ).toBe(true);
    });

    it("nests the weather toggle inside the widgets group when Nova and the widgets system pref are enabled", () => {
      setBoolPrefs({ "browser.newtabpage.activity-stream.nova.enabled": true });
      instance.store.getState = () => ({
        Prefs: { values: { "widgets.system.enabled": true } },
      });

      const group = instance._setupHomeGroup({ Preferences });

      expect(group.items.find(i => i.id === "weather")).toBeUndefined();
      const widgets = group.items.find(i => i.id === "widgets");
      expect(widgets.items.some(i => i.id === "weather")).toBe(true);
    });

    it("nests the weather toggle inside the widgets group when the container is enabled via trainhopConfig", () => {
      setBoolPrefs({ "browser.newtabpage.activity-stream.nova.enabled": true });
      instance.store.getState = () => ({
        Prefs: { values: { trainhopConfig: { widgets: { enabled: true } } } },
      });

      const group = instance._setupHomeGroup({ Preferences });

      expect(group.items.find(i => i.id === "weather")).toBeUndefined();
      const widgets = group.items.find(i => i.id === "widgets");
      const nestedWeather = widgets.items.find(i => i.id === "weather");
      expect(nestedWeather).toBeDefined();
      // Nested under Widgets, Weather is a checkbox like its siblings.
      expect(nestedWeather).not.toHaveProperty("control");
    });

    it("keeps the weather toggle standalone when Nova is enabled but the widgets system pref is off", () => {
      setBoolPrefs({ "browser.newtabpage.activity-stream.nova.enabled": true });
      instance.store.getState = () => ({
        Prefs: {
          values: {
            "widgets.system.enabled": false,
            "widgets.system.weather.enabled": true,
          },
        },
      });

      const group = instance._setupHomeGroup({ Preferences });

      expect(group.items.some(i => i.id === "weather")).toBe(true);
      const widgets = group.items.find(i => i.id === "widgets");
      expect(widgets.items.some(i => i.id === "weather")).toBe(false);
    });

    it("keeps the weather toggle as a standalone row when Nova is disabled", () => {
      setBoolPrefs({
        "browser.newtabpage.activity-stream.nova.enabled": false,
      });

      const group = instance._setupHomeGroup({ Preferences });

      const standaloneWeather = group.items.find(i => i.id === "weather");
      expect(standaloneWeather).toBeDefined();
      // Standalone, Weather is a top-level toggle like the other rows.
      expect(standaloneWeather.control).toBe("moz-toggle");
      const widgets = group.items.find(i => i.id === "widgets");
      expect(widgets.items.some(i => i.id === "weather")).toBe(false);
    });
  });
});
