import { render, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { createStore, combineReducers } from "redux";
import { INITIAL_STATE, reducers } from "common/Reducers.sys.mjs";
import { WIDGET_REGISTRY } from "common/WidgetsRegistry.mjs";
import { WrapWithProvider } from "test/jest/test-utils";
import { WidgetsManagementPanel } from "content-src/components/Nova/CustomizeMenu/WidgetsManagementPanel/WidgetsManagementPanel";

const DEFAULT_PROPS = {
  togglePanel: jest.fn(),
  showPanel: false,
  enabledSections: {
    weatherEnabled: false,
  },
  enabledWidgets: {
    timerEnabled: false,
    listsEnabled: false,
    widgetsMaximized: false,
    widgetsMayBeMaximized: false,
  },
  mayHaveWeather: false,
  mayHaveTimerWidget: false,
  mayHaveListsWidget: false,
  mayHaveWeatherForecast: false,
  weatherDisplay: "simple",
  setPref: jest.fn(),
};

const defaultSizeFor = telemetryName =>
  WIDGET_REGISTRY.find(w => w.telemetryName === telemetryName).defaultSize;

function stateWithPrefs(values) {
  return {
    ...INITIAL_STATE,
    Prefs: {
      ...INITIAL_STATE.Prefs,
      values: { ...INITIAL_STATE.Prefs.values, ...values },
    },
  };
}

// The toggles are moz-toggle custom elements: jsdom has no upgraded definition,
// so the test plays the part of the element and fires the toggle event with the
// dataset and pressed state the real widget would carry.
function fireToggle(toggle, { preference, eventSource, pressed }) {
  toggle.dataset.preference = preference;
  toggle.dataset.eventSource = eventSource;
  toggle.pressed = pressed;
  fireEvent(toggle, new Event("toggle"));
}

describe("<WidgetsManagementPanel>", () => {
  let props;

  function renderPanel(overrides = {}, state = INITIAL_STATE) {
    const store = createStore(combineReducers(reducers), state);
    jest.spyOn(store, "dispatch");
    const utils = render(
      <Provider store={store}>
        <WidgetsManagementPanel {...props} {...overrides} />
      </Provider>
    );
    return { ...utils, store };
  }

  function dispatchedActions(store) {
    return store.dispatch.mock.calls.map(([action]) => action);
  }

  beforeEach(() => {
    props = {
      togglePanel: jest.fn(),
      showPanel: false,
      enabledSections: { weatherEnabled: false },
      enabledWidgets: {
        timerEnabled: false,
        listsEnabled: false,
        widgetsMaximized: false,
        widgetsMayBeMaximized: false,
      },
      mayHaveWeather: true,
      mayHaveTimerWidget: true,
      mayHaveListsWidget: true,
      mayHaveWeatherForecast: false,
      weatherDisplay: "simple",
      setPref: jest.fn(),
    };
  });

  it("should render", () => {
    const { container } = render(
      <WrapWithProvider>
        <WidgetsManagementPanel {...DEFAULT_PROPS} />
      </WrapWithProvider>
    );
    expect(
      container.querySelector(".widgets-mgmt-panel-container")
    ).toBeInTheDocument();
  });

  it("should render the component", () => {
    const { container } = renderPanel();
    expect(
      container.querySelector(".widgets-mgmt-panel-container")
    ).toBeInTheDocument();
  });

  it("should render the manage widgets button", () => {
    const { container } = renderPanel();
    expect(container.querySelector("moz-box-button")).toBeInTheDocument();
  });

  it("should call togglePanel when button is clicked", () => {
    const { container } = renderPanel();
    fireEvent.click(container.querySelector("moz-box-button"));
    expect(props.togglePanel).toHaveBeenCalledTimes(1);
  });

  it("should render the panel when showPanel is true", () => {
    const { container } = renderPanel({ showPanel: true });
    expect(container.querySelector(".widgets-mgmt-panel")).toBeInTheDocument();
  });

  it("should not render the panel when showPanel is false", () => {
    const { container } = renderPanel({ showPanel: false });
    expect(
      container.querySelector(".widgets-mgmt-panel")
    ).not.toBeInTheDocument();
  });

  it("should call togglePanel when arrow button is clicked", () => {
    const { container } = renderPanel({ showPanel: true });
    fireEvent.click(container.querySelector(".arrow-button"));
    expect(props.togglePanel).toHaveBeenCalledTimes(1);
  });

  it("gives the back button an accessible name and tooltip", () => {
    const { container } = renderPanel({ showPanel: true });
    expect(container.querySelector("moz-button.arrow-button")).toHaveAttribute(
      "data-l10n-id",
      "newtab-customize-panel-back-button"
    );
  });

  it("should render panel title", () => {
    const { container } = renderPanel({ showPanel: true });
    const panel = container.querySelector(".widgets-mgmt-panel");
    expect(panel).toBeInTheDocument();
    expect(panel.querySelectorAll("h2")).toHaveLength(1);
  });

  describe("widget toggles", () => {
    it("should render weather toggle when mayHaveWeather is true", () => {
      const { container } = renderPanel({ showPanel: true });
      expect(container.querySelector("#weather-toggle")).toBeInTheDocument();
    });

    it("should not render weather toggle when mayHaveWeather is false", () => {
      const { container } = renderPanel({
        showPanel: true,
        mayHaveWeather: false,
      });
      expect(
        container.querySelector("#weather-toggle")
      ).not.toBeInTheDocument();
    });

    it("should render timer toggle when mayHaveTimerWidget is true", () => {
      const { container } = renderPanel({ showPanel: true });
      expect(container.querySelector("#timer-toggle")).toBeInTheDocument();
    });

    it("should not render timer toggle when mayHaveTimerWidget is false", () => {
      const { container } = renderPanel({
        showPanel: true,
        mayHaveTimerWidget: false,
      });
      expect(container.querySelector("#timer-toggle")).not.toBeInTheDocument();
    });

    it("should render lists toggle when mayHaveListsWidget is true", () => {
      const { container } = renderPanel({ showPanel: true });
      expect(container.querySelector("#lists-toggle")).toBeInTheDocument();
    });

    it("should not render lists toggle when mayHaveListsWidget is false", () => {
      const { container } = renderPanel({
        showPanel: true,
        mayHaveListsWidget: false,
      });
      expect(container.querySelector("#lists-toggle")).not.toBeInTheDocument();
    });

    it("should reflect weatherEnabled in weather toggle pressed state", () => {
      const { container } = renderPanel({
        showPanel: true,
        enabledSections: { weatherEnabled: true },
      });
      expect(container.querySelector("#weather-toggle")).toHaveAttribute(
        "pressed"
      );
    });

    it("should reflect timerEnabled in timer toggle pressed state", () => {
      const { container } = renderPanel({
        showPanel: true,
        enabledWidgets: { ...props.enabledWidgets, timerEnabled: true },
      });
      expect(container.querySelector("#timer-toggle")).toHaveAttribute(
        "pressed"
      );
    });

    it("should reflect listsEnabled in lists toggle pressed state", () => {
      const { container } = renderPanel({
        showPanel: true,
        enabledWidgets: { ...props.enabledWidgets, listsEnabled: true },
      });
      expect(container.querySelector("#lists-toggle")).toHaveAttribute(
        "pressed"
      );
    });
  });

  describe("dispatch on toggle", () => {
    it("should dispatch PREF_CHANGED and WIDGETS_ENABLED when weather toggle is fired", () => {
      const { container, store } = renderPanel({ showPanel: true });

      fireToggle(container.querySelector("#weather-toggle"), {
        preference: "showWeather",
        eventSource: "WEATHER",
        pressed: true,
      });

      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "TELEMETRY_USER_EVENT" })
      );
      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "WIDGETS_ENABLED" })
      );
    });

    it("should call setPref when a toggle is fired", () => {
      const { container } = renderPanel({ showPanel: true });

      fireToggle(container.querySelector("#weather-toggle"), {
        preference: "showWeather",
        eventSource: "WEATHER",
        pressed: true,
      });

      expect(props.setPref).toHaveBeenCalledTimes(1);
      expect(props.setPref).toHaveBeenCalledWith("showWeather", true);
    });

    it("should dispatch PREF_CHANGED and WIDGETS_ENABLED when lists toggle is fired", () => {
      const { container, store } = renderPanel({ showPanel: true });

      fireToggle(container.querySelector("#lists-toggle"), {
        preference: "widgets.lists.enabled",
        eventSource: "WIDGET_LISTS",
        pressed: true,
      });

      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "TELEMETRY_USER_EVENT" })
      );
      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "WIDGETS_ENABLED" })
      );
    });

    it("should call setPref when lists toggle is fired", () => {
      const { container } = renderPanel({ showPanel: true });

      fireToggle(container.querySelector("#lists-toggle"), {
        preference: "widgets.lists.enabled",
        eventSource: "WIDGET_LISTS",
        pressed: true,
      });

      expect(props.setPref).toHaveBeenCalledTimes(1);
      expect(props.setPref).toHaveBeenCalledWith("widgets.lists.enabled", true);
    });

    it("should dispatch PREF_CHANGED and WIDGETS_ENABLED when timer toggle is fired", () => {
      const { container, store } = renderPanel({ showPanel: true });

      fireToggle(container.querySelector("#timer-toggle"), {
        preference: "widgets.focusTimer.enabled",
        eventSource: "WIDGET_TIMER",
        pressed: true,
      });

      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "TELEMETRY_USER_EVENT" })
      );
      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "WIDGETS_ENABLED" })
      );
    });

    it("should call setPref when timer toggle is fired", () => {
      const { container } = renderPanel({ showPanel: true });

      fireToggle(container.querySelector("#timer-toggle"), {
        preference: "widgets.focusTimer.enabled",
        eventSource: "WIDGET_TIMER",
        pressed: true,
      });

      expect(props.setPref).toHaveBeenCalledTimes(1);
      expect(props.setPref).toHaveBeenCalledWith(
        "widgets.focusTimer.enabled",
        true
      );
    });

    it("should dispatch WIDGETS_ENABLED with enabled: false when toggled off", () => {
      const { container, store } = renderPanel({ showPanel: true });

      fireToggle(container.querySelector("#weather-toggle"), {
        preference: "showWeather",
        eventSource: "WEATHER",
        pressed: false,
      });

      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "WIDGETS_ENABLED",
          data: expect.objectContaining({ enabled: false }),
        })
      );
    });

    it("should dispatch WIDGETS_ENABLED with the weather widget's registry default size when no pref is set", () => {
      const { container, store } = renderPanel({ showPanel: true });

      fireToggle(container.querySelector("#weather-toggle"), {
        preference: "showWeather",
        eventSource: "WEATHER",
        pressed: true,
      });

      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "WIDGETS_ENABLED",
          data: expect.objectContaining({
            widget_size: defaultSizeFor("weather"),
          }),
        })
      );
    });

    it("should reflect a user-set weather size pref in widget_size", () => {
      const { container, store } = renderPanel(
        { showPanel: true },
        stateWithPrefs({ "widgets.weather.size": "large" })
      );

      fireToggle(container.querySelector("#weather-toggle"), {
        preference: "showWeather",
        eventSource: "WEATHER",
        pressed: true,
      });

      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "WIDGETS_ENABLED",
          data: expect.objectContaining({ widget_size: "large" }),
        })
      );
    });

    it("should reflect a trainhopConfig size override when no size pref is set", () => {
      const { container, store } = renderPanel(
        { showPanel: true },
        stateWithPrefs({
          trainhopConfig: { widgets: { weatherSize: "large" } },
        })
      );

      fireToggle(container.querySelector("#weather-toggle"), {
        preference: "showWeather",
        eventSource: "WEATHER",
        pressed: true,
      });

      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "WIDGETS_ENABLED",
          data: expect.objectContaining({ widget_size: "large" }),
        })
      );
    });

    it("should dispatch WIDGETS_ENABLED with the focus timer widget's registry default size when no pref is set", () => {
      const { container, store } = renderPanel({ showPanel: true });

      fireToggle(container.querySelector("#timer-toggle"), {
        preference: "widgets.focusTimer.enabled",
        eventSource: "WIDGET_TIMER",
        pressed: true,
      });

      const widgetsEnabled = dispatchedActions(store).find(
        action => action.type === "WIDGETS_ENABLED"
      );
      expect(widgetsEnabled).toBeDefined();
      expect(widgetsEnabled.data.widget_size).toBe(
        defaultSizeFor("focus_timer")
      );
    });
  });
});
