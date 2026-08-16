/* globals gBrowser */

(function () {
  "use strict";

  const PROCESS_SCRIPT =
    "chrome://browser/content/komorebi/komorebi-process.js";
  const MODULE_SCRIPTS = [
    "chrome://browser/content/komorebi/komorebi-video-renderer.js",
    "chrome://browser/content/komorebi/komorebi-web-renderer.js",
    "chrome://browser/content/komorebi/komorebi-library.js",
  ];
  const SCENE_RENDERER_MODULE =
    "chrome://browser/content/komorebi/dist/renderer/SceneRenderer.js";
  const ACTIVE_PAGE =
    /^(?:about:(?:home|newtab|welcome)(?:[?#].*)?|https:\/\/(?:www\.)?google\.[^/]+\/search(?:[?#]|$))/;

  Services.prefs.setBoolPref("browser.tabs.allow_transparent_browser", true);

  const processScriptLoaded = Array.from(
    Services.ppmm.getDelayedProcessScripts(),
    ([uri]) => uri
  ).includes(PROCESS_SCRIPT);
  if (!processScriptLoaded) {
    Services.ppmm.loadProcessScript(PROCESS_SCRIPT, true);
  }

  window.windowUtils.loadSheet(
    Services.io.newURI("chrome://browser/content/komorebi/komorebi-chrome.css"),
    window.windowUtils.AUTHOR_SHEET
  );

  for (const script of MODULE_SCRIPTS) {
    Services.scriptloader.loadSubScript(script, window);
  }

  let renderers;
  const progressListener = {
    onLocationChange() {
      updatePageState();
    },
  };

  function updatePageState() {
    const uri = gBrowser.selectedBrowser.currentURI?.spec || "";
    const active = ACTIVE_PAGE.test(uri) && document.hasFocus();
    renderers?.scene.setPageActive(active);
    renderers?.video.setPageActive(active);
  }

  function cleanup() {
    gBrowser.removeTabsProgressListener(progressListener);
    gBrowser.tabContainer.removeEventListener("TabSelect", updatePageState);
    window.removeEventListener("sizemodechange", updatePageState);
    window.removeEventListener("focus", updatePageState);
    window.removeEventListener("blur", updatePageState);
    renderers?.scene.destroy();
    renderers?.video.destroy();
  }

  async function init() {
    const { SceneRenderer } = await import(SCENE_RENDERER_MODULE);
    renderers = {
      scene: new SceneRenderer(),
      video: new window.KomorebiVideoRenderer(),
      web: new window.KomorebiWebRenderer(),
    };
    renderers.scene.init();
    renderers.video.init();
    gBrowser.addTabsProgressListener(progressListener);
    gBrowser.tabContainer.addEventListener("TabSelect", updatePageState);
    window.addEventListener("sizemodechange", updatePageState);
    window.addEventListener("focus", updatePageState);
    window.addEventListener("blur", updatePageState);
    window.addEventListener("unload", cleanup, { once: true });
    updatePageState();

    await window.KomorebiLibrary.init({
      renderers,
    });
  }

  if (document.readyState === "loading") {
    window.addEventListener(
      "DOMContentLoaded",
      () => init().catch(reportError),
      {
        once: true,
      }
    );
  } else {
    init().catch(reportError);
  }

  function reportError(error) {
    console.error("Komorebi failed to initialize", error);
  }
})();
