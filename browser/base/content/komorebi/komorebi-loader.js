(function () {
  "use strict";

  const PROCESS_SCRIPT =
    "chrome://browser/content/komorebi/komorebi-process.js";
  const LIBRARY_SCRIPT =
    "chrome://browser/content/komorebi/komorebi-library.js";

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

  let canvas;
  let context;
  let video;
  let objectUrl;
  let animationFrame = null;
  let resizeObserver;

  Services.scriptloader.loadSubScript(LIBRARY_SCRIPT, window);

  function createCanvas() {
    const container = document.createElement("div");
    container.id = "komorebi-container";

    canvas = document.createElement("canvas");
    canvas.id = "komorebi-canvas";
    context = canvas.getContext("2d", { alpha: true });

    container.appendChild(canvas);
    return container;
  }

  function resizeCanvas() {
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * scale);
    canvas.height = Math.round(window.innerHeight * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function fetchVideo(videoPath) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("GET", videoPath, true);
      request.responseType = "blob";
      request.onload = () => {
        if (request.status === 0 || request.status === 200) {
          resolve(request.response);
        } else {
          reject(new Error(`Video request failed: ${request.status}`));
        }
      };
      request.onerror = () => reject(new Error("Video request failed"));
      request.send();
    });
  }

  function renderFrame() {
    if (
      window.windowState !== window.STATE_MINIMIZED &&
      !video.paused &&
      !video.ended
    ) {
      const scale = window.devicePixelRatio || 1;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      context.drawImage(
        video,
        0,
        0,
        canvas.width / scale,
        canvas.height / scale
      );
    }
    animationFrame = requestAnimationFrame(renderFrame);
  }

  async function loadVideo(videoPath) {
    try {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      video?.remove();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }

      objectUrl = URL.createObjectURL(await fetchVideo(videoPath));
      video = document.createElement("video");
      video.id = "komorebi-video";
      video.src = objectUrl;
      video.loop = true;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      document.body.appendChild(video);

      video.addEventListener(
        "loadeddata",
        () => {
          video.play().catch(() => {});
          renderFrame();
        },
        { once: true }
      );
    } catch (error) {
      console.error("Komorebi video failed to load", error);
    }
  }

  function cleanup() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    resizeObserver?.disconnect();
  }

  function init() {
    const container = createCanvas();
    document.body.prepend(container);
    resizeCanvas();

    resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(document.documentElement);

    window.KomorebiLibrary.init(loadVideo).catch(error => {
      console.error("Komorebi library failed to initialize", error);
    });
    window.addEventListener("unload", cleanup, { once: true });
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
