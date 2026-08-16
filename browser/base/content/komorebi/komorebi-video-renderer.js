(function (global) {
  "use strict";

  class VideoRenderer {
    #animationFrame = null;
    #canvas;
    #context;
    #fit = "cover";
    #lastFrameTime = 0;
    #loadGeneration = 0;
    #maxFPS = 30;
    #muted = false;
    #objectUrl;
    #pageActive = true;
    #paused = false;
    #resizeObserver;
    #video;
    #visible = true;
    #volume = 0.5;

    init() {
      const container = document.createElement("div");
      container.id = "komorebi-container";

      this.#canvas = document.createElement("canvas");
      this.#canvas.id = "komorebi-canvas";
      this.#context = this.#canvas.getContext("2d", { alpha: true });
      container.appendChild(this.#canvas);
      document.body.prepend(container);

      this.#resizeCanvas();
      this.#resizeObserver = new ResizeObserver(() => this.#resizeCanvas());
      this.#resizeObserver.observe(document.documentElement);
    }

    async load(source) {
      const generation = ++this.#loadGeneration;
      const objectUrl = URL.createObjectURL(await this.#fetchVideo(source));
      if (generation !== this.#loadGeneration) {
        URL.revokeObjectURL(objectUrl);
        return false;
      }

      const video = document.createElement("video");
      video.id = "komorebi-video-pending";
      video.src = objectUrl;
      video.loop = true;
      video.playsInline = true;
      this.#applySettings(video);
      try {
        await new Promise((resolve, reject) => {
          video.addEventListener("loadeddata", resolve, { once: true });
          video.addEventListener(
            "error",
            () => reject(new Error("Video decoding failed")),
            { once: true }
          );
          video.load();
        });
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
      }

      if (generation !== this.#loadGeneration) {
        URL.revokeObjectURL(objectUrl);
        return false;
      }

      this.#releaseVideo();
      this.#objectUrl = objectUrl;
      this.#video = video;
      this.#video.id = "komorebi-video";
      document.body.appendChild(this.#video);
      this.#animationFrame = requestAnimationFrame(time => this.#render(time));
      await this.#updatePlayback();
      return true;
    }

    updateSettings(settings) {
      this.#fit = settings.fit;
      this.#maxFPS = settings.maxFPS;
      this.#muted = settings.muted;
      this.#paused = settings.paused;
      this.#volume = settings.volume;
      this.#applySettings();
      this.#updatePlayback();
    }

    setPageActive(active) {
      this.#pageActive = active;
      this.#updatePlayback();
    }

    setVisible(visible) {
      this.#visible = visible;
      this.#canvas.parentElement.hidden = !visible;
      this.#updatePlayback();
    }

    destroy() {
      this.#loadGeneration++;
      this.#releaseVideo();
      this.#resizeObserver?.disconnect();
      this.#canvas?.parentElement?.remove();
    }

    #applySettings(video = this.#video) {
      if (!video) {
        return;
      }
      video.muted = this.#muted;
      video.volume = this.#volume;
    }

    #fetchVideo(source) {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("GET", source, true);
        request.responseType = "blob";
        request.onload = () => {
          if (request.status === 0 || request.status === 200) {
            resolve(request.response);
          } else {
            reject(
              new Error(`Video request failed: ${request.status} (${source})`)
            );
          }
        };
        // Fires for a network-level failure (bad/unreachable path, or a
        // "video" project whose declared file isn't actually a single
        // fetchable file — e.g. a "web" project's HTML entry point routed
        // here as a fallback). Including `source` is what tells those two
        // apart from the console instead of guessing.
        request.onerror = () =>
          reject(new Error(`Video request failed (${source})`));
        request.send();
      });
    }

    #releaseVideo() {
      if (this.#animationFrame !== null) {
        cancelAnimationFrame(this.#animationFrame);
        this.#animationFrame = null;
      }
      this.#video?.remove();
      this.#video = null;
      if (this.#objectUrl) {
        URL.revokeObjectURL(this.#objectUrl);
        this.#objectUrl = null;
      }
    }

    #render(time) {
      if (
        this.#video &&
        !this.#video.paused &&
        time - this.#lastFrameTime >= 1000 / this.#maxFPS
      ) {
        this.#drawFrame();
        this.#lastFrameTime = time;
      }
      this.#animationFrame = requestAnimationFrame(nextTime =>
        this.#render(nextTime)
      );
    }

    #drawFrame() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.#context.clearRect(0, 0, width, height);

      if (this.#fit === "stretch") {
        this.#context.drawImage(this.#video, 0, 0, width, height);
        return;
      }

      const scale =
        this.#fit === "contain"
          ? Math.min(
              width / this.#video.videoWidth,
              height / this.#video.videoHeight
            )
          : Math.max(
              width / this.#video.videoWidth,
              height / this.#video.videoHeight
            );
      const drawWidth = this.#video.videoWidth * scale;
      const drawHeight = this.#video.videoHeight * scale;
      this.#context.drawImage(
        this.#video,
        (width - drawWidth) / 2,
        (height - drawHeight) / 2,
        drawWidth,
        drawHeight
      );
    }

    #resizeCanvas() {
      const scale = window.devicePixelRatio || 1;
      this.#canvas.width = Math.round(window.innerWidth * scale);
      this.#canvas.height = Math.round(window.innerHeight * scale);
      this.#context.setTransform(scale, 0, 0, scale, 0, 0);
    }

    async #updatePlayback() {
      if (!this.#video) {
        return;
      }
      if (
        this.#paused ||
        !this.#pageActive ||
        !this.#visible ||
        window.windowState === window.STATE_MINIMIZED
      ) {
        this.#video.pause();
      } else {
        await this.#video.play().catch(() => {});
      }
    }
  }

  global.KomorebiVideoRenderer = VideoRenderer;
})(this);
