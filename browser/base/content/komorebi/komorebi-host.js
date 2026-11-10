/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* globals File, MousePosTracker */

(function (global) {
  "use strict";

  const AUDIO_MODULE =
    "chrome://browser/content/komorebi/dist/audio/SceneAudioPlayer.js";
  const AUDIO_METHODS = new Set([
    "destroy",
    "init",
    "load",
    "setActive",
    "setDucked",
    "setOverlayVisible",
    "updateSettings",
  ]);
  const FRAME_SCRIPT =
    "chrome://browser/content/komorebi/komorebi-host-frame.js";
  const FROM_PAGE = "Komorebi:Host:FromPage";
  const TO_PAGE = "Komorebi:Host:ToPage";
  const HOST_ID = "komorebi-wallpaper-host";
  const HIDDEN_ATTRIBUTE = "komorebi-hidden";
  const PAGE_URL =
    "data:text/html," +
    encodeURIComponent(
      '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'
    );
  const BROWSER_ATTRIBUTES = [
    ["id", HOST_ID],
    ["type", "content"],
    ["remote", "true"],
    ["remoteType", "web"],
    ["maychangeremoteness", "true"],
    ["disableglobalhistory", "true"],
    ["initiallyactive", "true"],
    ["nodefaultsrc", "true"],
    ["messagemanagergroup", "komorebi"],
    ["transparent", "true"],
    ["tabindex", "-1"],
    ["aria-hidden", "true"],
  ];
  const DOCUMENT_POLL_MS = 20;
  const START_TIMEOUT_MS = 30000;
  const MOUSE_INTERVAL_MS = 33;
  const TARGETS = ["scene", "video", "image"];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  class RendererProxy {
    state = {
      audioAllowed: true,
      audioDucked: false,
      fps: 0,
      pageActive: true,
      running: true,
      settings: null,
      visible: false,
    };
    #host;
    #target;

    constructor(host, target) {
      this.#host = host;
      this.#target = target;
    }

    get fps() {
      return this.state.fps;
    }

    init() {}

    load(options) {
      return this.#host.load(this.#target, options);
    }

    setVisible(visible) {
      this.#update("visible", "setVisible", visible);
    }

    setPageActive(active) {
      this.#update("pageActive", "setPageActive", active);
    }

    setRunning(running) {
      this.#update("running", "setRunning", running);
    }

    setAudioAllowed(allowed) {
      this.#update("audioAllowed", "setAudioAllowed", allowed);
    }

    setAudioDucked(ducked) {
      this.#update("audioDucked", "setAudioDucked", ducked);
    }

    updateSettings(settings) {
      this.#update("settings", "updateSettings", settings);
    }

    /** Releases the content process; the next load() recreates it. */
    unload() {
      this.#host.unload();
    }

    destroy() {
      this.#host.destroy();
    }

    #update(key, method, value) {
      this.state[key] = value;
      this.#host.stateChanged(this.#target, method, value);
    }
  }

  /**
   * Owns the remote <browser> that runs the wallpaper engines in a content
   * process, where hardware video decoding is allowed. The browser is only
   * created by the first load().
   */
  class KomorebiWallpaperHost {
    scene = new RendererProxy(this, "scene");
    video = new RendererProxy(this, "video");
    image = new RendererProxy(this, "image");
    #audio = null;
    #browser = null;
    #destroyed = false;
    #lastLoad = null;
    #lastMouse = 0;
    #mouseListening = false;
    #mouseTimer = null;
    #nextId = 1;
    #pending = new Map();
    #ready = false;
    #readyDeferred = null;
    #roots = { image: [], scene: [], video: [] };
    #starting = null;

    constructor() {
      window.addEventListener("oop-browser-crashed", this.#onCrash, true);
    }

    async load(target, options) {
      if (this.#destroyed) {
        return false;
      }
      const entry = {
        cancelled: false,
        crashes: 0,
        options,
        rerun: false,
        running: false,
        target,
      };
      this.#lastLoad = entry;
      return this.#runLoad(entry);
    }

    stateChanged(target, method, value) {
      if (this.#ready) {
        this.#post({ args: [value], method, target, type: "call" });
      }
      this.#refresh();
    }

    unload() {
      this.#cancelLoads();
      this.#teardown(new Error("Wallpaper host unloaded"));
    }

    destroy() {
      if (this.#destroyed) {
        return;
      }
      this.#destroyed = true;
      window.removeEventListener("oop-browser-crashed", this.#onCrash, true);
      this.unload();
    }

    receiveMessage({ data }) {
      if (!data || typeof data !== "object") {
        return;
      }
      switch (data.type) {
        case "ready":
          this.#readyDeferred?.resolve();
          break;
        case "fail":
          if (this.#readyDeferred) {
            this.#readyDeferred.reject(new Error(String(data.error)));
          } else {
            console.error("Komorebi host page failed", data.error);
          }
          break;
        case "result":
          this.#settle(data);
          break;
        case "fps":
          this.scene.state.fps = Number(data.scene) || 0;
          this.video.state.fps = Number(data.video) || 0;
          break;
        case "read":
          this.#handleRead(data);
          break;
        case "audio":
          this.#handleAudio(data);
          break;
      }
    }

    async #runLoad(entry) {
      for (;;) {
        entry.rerun = false;
        entry.running = true;
        try {
          const args = await this.#prepareLoad(entry);
          if (entry.cancelled) {
            return false;
          }
          await this.#ensure();
          if (entry.cancelled) {
            return false;
          }
          return await this.#call(entry.target, "load", args);
        } catch (error) {
          if (entry.cancelled) {
            return false;
          }
          if (!entry.rerun) {
            throw error;
          }
        } finally {
          entry.running = false;
        }
      }
    }

    async #prepareLoad({ options, target }) {
      if (target === "scene") {
        const { assetRoot, packageSource } = options;
        this.#roots.scene = [
          this.#fileFromURL(packageSource).parent,
          assetRoot ? this.#fileFromURL(assetRoot) : null,
        ]
          .filter(Boolean)
          .map(root => this.#normalized(root));
        return [options];
      }
      const file = this.#fileFromURL(options);
      if (target === "image") {
        // A picture is only ever shown from the library's own copy.
        const media = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        media.initWithPath(global.KomorebiMedia.root());
        this.#normalized(media);
        this.#normalized(file);
        if (!media.contains(file)) {
          throw new Error("Image outside the library");
        }
        this.#roots.image = [this.#normalized(file.parent)];
      } else {
        this.#roots.video = [this.#normalized(file.parent)];
      }
      return [await File.createFromNsIFile(file)];
    }

    #fileFromURL(spec) {
      if (typeof spec !== "string") {
        throw new Error("Invalid file URL");
      }
      const uri = Services.io.newURI(spec);
      if (!uri.schemeIs("file")) {
        throw new Error("Not a file URL");
      }
      return Services.io
        .getProtocolHandler("file")
        .QueryInterface(Ci.nsIFileProtocolHandler)
        .getFileFromURLSpec(uri.spec);
    }

    #normalized(file) {
      try {
        file.normalize();
      } catch {}
      return file;
    }

    #isAllowed(file) {
      return [
        ...this.#roots.scene,
        ...this.#roots.video,
        ...this.#roots.image,
      ].some(root => root.contains(file));
    }

    async #handleRead({ id, source }) {
      try {
        const file = this.#fileFromURL(source);
        file.normalize();
        if (!this.#isAllowed(file)) {
          throw new Error("Read denied");
        }
        const blob = await File.createFromNsIFile(file);
        this.#post({ blob, id, type: "readResult" });
      } catch (error) {
        this.#post({
          error: String(error?.message ?? error),
          id,
          type: "readResult",
        });
      }
    }

    #handleAudio({ args, method }) {
      const callArgs = args ?? [];
      if (!AUDIO_METHODS.has(method) || !Array.isArray(callArgs)) {
        return;
      }
      if (method === "init") {
        this.#audio ??= import(AUDIO_MODULE)
          .then(({ SceneAudioPlayer }) => {
            const player = new SceneAudioPlayer();
            player.init();
            return player;
          })
          .catch(error => {
            console.error("Komorebi could not start the scene audio", error);
            return null;
          });
        return;
      }
      if (!this.#audio) {
        return;
      }
      this.#audio = this.#audio.then(async player => {
        try {
          const finalArgs =
            method === "load"
              ? [await this.#copyTracks(callArgs[0] ?? [])]
              : callArgs;
          player?.[method](...finalArgs);
        } catch (error) {
          console.error(`Komorebi scene audio ${method} failed`, error);
        }
        return player;
      });
    }

    #copyTracks(tracks) {
      return Promise.all(
        tracks.map(async track => ({
          ...track,
          blob: new Blob([await track.blob.arrayBuffer()], {
            type: track.mimeType,
          }),
        }))
      );
    }

    #destroyAudio() {
      const audio = this.#audio;
      this.#audio = null;
      audio?.then(player => player?.destroy());
    }

    #ensure() {
      if (this.#destroyed) {
        return Promise.reject(new Error("Wallpaper host destroyed"));
      }
      if (!this.#starting) {
        const starting = this.#start();
        this.#starting = starting;
        starting.catch(() => {
          if (this.#starting === starting) {
            this.#starting = null;
          }
        });
      }
      return this.#starting;
    }

    async #start() {
      const browser = this.#createBrowser();
      let deferred;
      try {
        const messageManager = browser.messageManager;
        messageManager.addMessageListener(FROM_PAGE, this);
        browser.fixupAndLoadURIString(PAGE_URL, {
          triggeringPrincipal:
            Services.scriptSecurityManager.getSystemPrincipal(),
        });
        await this.#waitForDocument(browser);
        browser.docShellIsActive = true;
        browser.renderLayers = true;
        const ready = new Promise((resolve, reject) => {
          deferred = { reject, resolve };
        });
        this.#readyDeferred = deferred;
        messageManager.loadFrameScript(FRAME_SCRIPT, false);
        await Promise.race([
          ready,
          delay(START_TIMEOUT_MS).then(() => {
            throw new Error("Wallpaper host did not start");
          }),
        ]);
        if (this.#browser !== browser) {
          throw new Error("Wallpaper host unloaded");
        }
        this.#ready = true;
        this.#replayState();
        this.#refresh();
      } catch (error) {
        if (this.#browser === browser) {
          this.#teardown(error);
        }
        throw error;
      } finally {
        if (deferred && this.#readyDeferred === deferred) {
          this.#readyDeferred = null;
        }
      }
    }

    #createBrowser() {
      const browser = document.createXULElement("browser");
      for (const [name, value] of BROWSER_ATTRIBUTES) {
        browser.setAttribute(name, value);
      }
      browser.toggleAttribute(HIDDEN_ATTRIBUTE, true);
      document.body.prepend(browser);
      this.#browser = browser;
      return browser;
    }

    async #waitForDocument(browser) {
      const deadline = Date.now() + START_TIMEOUT_MS;
      for (;;) {
        if (this.#browser !== browser) {
          throw new Error("Wallpaper host unloaded");
        }
        const spec =
          browser.browsingContext?.currentWindowGlobal?.documentURI?.spec;
        if (spec?.startsWith("data:")) {
          return;
        }
        if (Date.now() > deadline) {
          throw new Error("Wallpaper host page did not load");
        }
        await delay(DOCUMENT_POLL_MS);
      }
    }

    #replayState() {
      for (const target of TARGETS) {
        const { state } = this[target];
        const calls = [
          ["setPageActive", state.pageActive],
          ["setRunning", state.running],
          ["setAudioAllowed", state.audioAllowed],
          ["setAudioDucked", state.audioDucked],
        ];
        if (state.settings) {
          calls.push(["updateSettings", state.settings]);
        }
        calls.push(["setVisible", state.visible]);
        for (const [method, value] of calls) {
          this.#post({ args: [value], method, target, type: "call" });
        }
      }
    }

    #isShown(target) {
      const { pageActive, visible } = this[target].state;
      return visible && pageActive;
    }

    #refresh() {
      if (!this.#browser) {
        return;
      }
      const sceneShown = this.#isShown("scene");
      const anyShown =
        sceneShown || this.#isShown("video") || this.#isShown("image");
      this.#browser.toggleAttribute(HIDDEN_ATTRIBUTE, !anyShown);
      if (!anyShown) {
        this.scene.state.fps = 0;
        this.video.state.fps = 0;
      }
      const { running, settings } = this.scene.state;
      this.#syncMouse(
        this.#ready && sceneShown && running && !settings?.paused
      );
    }

    #syncMouse(wanted) {
      if (wanted && !this.#mouseListening) {
        this.#mouseListening = true;
        window.addEventListener("mousemove", this.#onMouseMove, {
          mozSystemGroup: true,
        });
        this.#sendPointer();
      } else if (!wanted && this.#mouseListening) {
        this.#mouseListening = false;
        window.removeEventListener("mousemove", this.#onMouseMove, {
          mozSystemGroup: true,
        });
        clearTimeout(this.#mouseTimer);
        this.#mouseTimer = null;
      }
    }

    #onMouseMove = () => {
      const wait = MOUSE_INTERVAL_MS - (performance.now() - this.#lastMouse);
      if (wait <= 0) {
        this.#sendPointer();
      } else if (this.#mouseTimer === null) {
        this.#mouseTimer = setTimeout(() => {
          this.#mouseTimer = null;
          this.#sendPointer();
        }, wait);
      }
    };

    #sendPointer() {
      this.#lastMouse = performance.now();
      const tracker =
        typeof MousePosTracker === "undefined" ? null : MousePosTracker;
      this.#post({ type: "pointer", x: tracker?._x, y: tracker?._y });
    }

    #onCrash = event => {
      if (!this.#browser || event.target !== this.#browser) {
        return;
      }
      const entry = this.#lastLoad;
      const retry = Boolean(entry) && ++entry.crashes === 1;
      if (retry && entry.running) {
        entry.rerun = true;
      }
      this.#teardown(new Error("Wallpaper host crashed"));
      if (retry && !entry.running) {
        this.#runLoad(entry).catch(error =>
          console.error("Komorebi could not restore the wallpaper", error)
        );
      }
    };

    #cancelLoads() {
      if (this.#lastLoad) {
        this.#lastLoad.cancelled = true;
        this.#lastLoad = null;
      }
    }

    #call(target, method, args) {
      return new Promise((resolve, reject) => {
        const id = this.#nextId++;
        this.#pending.set(id, { reject, resolve });
        this.#post({ args, id, method, target, type: "call" });
      });
    }

    #settle({ error, id, result }) {
      const pending = this.#pending.get(id);
      if (!pending) {
        return;
      }
      this.#pending.delete(id);
      if (error !== undefined) {
        pending.reject(new Error(String(error)));
      } else {
        pending.resolve(result);
      }
    }

    #post(message) {
      try {
        this.#browser?.messageManager.sendAsyncMessage(TO_PAGE, message);
      } catch (error) {
        console.error("Komorebi could not reach the wallpaper host", error);
      }
    }

    #teardown(error) {
      const browser = this.#browser;
      this.#browser = null;
      this.#starting = null;
      this.#ready = false;
      this.#syncMouse(false);
      this.#readyDeferred?.reject(error);
      this.#readyDeferred = null;
      for (const pending of this.#pending.values()) {
        pending.reject(error);
      }
      this.#pending.clear();
      this.#destroyAudio();
      this.#roots = { image: [], scene: [], video: [] };
      this.scene.state.fps = 0;
      this.video.state.fps = 0;
      if (browser) {
        try {
          browser.messageManager.removeMessageListener(FROM_PAGE, this);
        } catch {}
        browser.remove();
      }
    }
  }

  global.KomorebiWallpaperHost = KomorebiWallpaperHost;
})(this);
