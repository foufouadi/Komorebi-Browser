/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

const FPS_WINDOW_MS = 2000;
const FIT_STYLES = new Map([
  ["contain", "contain"],
  ["cover", "cover"],
  ["stretch", "fill"],
]);

export class VideoRenderer {
  #audioAllowed = true;
  #audioDucked = false;
  #container;
  #fit = "cover";
  #frameSamples = [];
  #loadGeneration = 0;
  #muted = false;
  #objectURL = null;
  #pageActive = true;
  #paused = false;
  #running = true;
  #speed = 1;
  #video = null;
  #visible = true;
  #volume = 0.5;

  init() {
    this.#container = document.createElement("div");
    this.#container.id = "komorebi-container";
    this.#container.hidden = true;
    document.body.prepend(this.#container);
  }

  /**
   * Frames per second over the last FPS_WINDOW_MS, from the decoder's
   * own frame counter.
   */
  get fps() {
    if (!this.#video) {
      return 0;
    }
    const now = performance.now();
    const total = this.#video.getVideoPlaybackQuality().totalVideoFrames;
    this.#frameSamples.push({ frames: total, time: now });
    while (
      this.#frameSamples.length > 2 &&
      now - this.#frameSamples[1].time >= FPS_WINDOW_MS
    ) {
      this.#frameSamples.shift();
    }
    const first = this.#frameSamples[0];
    const elapsed = now - first.time;
    return elapsed > 0 ? ((total - first.frames) * 1000) / elapsed : 0;
  }

  /**
   * @param {Blob} source
   */
  async load(source) {
    const generation = ++this.#loadGeneration;
    const objectURL = URL.createObjectURL(source);
    const video = document.createElement("video");
    video.src = objectURL;
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
      this.#discardVideo(video, objectURL);
      throw error;
    }

    if (generation !== this.#loadGeneration) {
      this.#discardVideo(video, objectURL);
      return false;
    }

    this.#releaseVideo();
    this.#video = video;
    this.#objectURL = objectURL;
    this.#frameSamples = [];
    this.#applyFit();
    this.#container.appendChild(video);
    this.#updateVisibility();
    await this.#updatePlayback();
    return true;
  }

  updateSettings(settings) {
    this.#fit = settings.fit;
    this.#muted = settings.muted;
    this.#paused = settings.paused;
    this.#speed = settings.speed || 1;
    this.#volume = settings.volume;
    this.#applyFit();
    this.#applySettings();
    this.#updatePlayback();
  }

  setPageActive(active) {
    this.#pageActive = active;
    this.#updateVisibility();
    this.#updatePlayback();
  }

  setRunning(running) {
    this.#running = running;
    this.#updatePlayback();
  }

  setAudioAllowed(allowed) {
    this.#audioAllowed = allowed;
    this.#applySettings();
    this.#updatePlayback();
  }

  setAudioDucked(ducked) {
    this.#audioDucked = ducked;
    this.#applySettings();
  }

  setVisible(visible) {
    this.#visible = visible;
    this.#updateVisibility();
    this.#updatePlayback();
  }

  destroy() {
    this.#loadGeneration++;
    this.#releaseVideo();
    this.#container?.remove();
  }

  #applyFit() {
    if (this.#video) {
      this.#video.style.objectFit = FIT_STYLES.get(this.#fit) ?? "cover";
    }
  }

  #applySettings(video = this.#video) {
    if (!video) {
      return;
    }
    video.muted = this.#isSilent();
    video.volume = this.#volume;
    video.playbackRate = this.#speed;
  }

  #isSilent() {
    return (
      this.#muted ||
      !this.#audioAllowed ||
      this.#audioDucked ||
      this.#volume === 0
    );
  }

  #discardVideo(video, objectURL) {
    video.remove();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectURL);
  }

  #releaseVideo() {
    if (this.#video) {
      this.#discardVideo(this.#video, this.#objectURL);
    }
    this.#video = null;
    this.#objectURL = null;
    this.#frameSamples = [];
  }

  #updateVisibility() {
    this.#container.hidden = !(this.#visible && this.#pageActive);
  }

  async #updatePlayback() {
    if (!this.#video) {
      return;
    }
    const showPicture =
      !this.#paused && this.#pageActive && this.#visible && this.#running;
    const playSound = !this.#paused && this.#visible && !this.#isSilent();
    if (showPicture || playSound) {
      await this.#video.play().catch(() => {});
    } else {
      this.#video.pause();
    }
  }
}
