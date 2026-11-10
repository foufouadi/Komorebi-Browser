/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

const FIT_STYLES = new Map([
  ["contain", "contain"],
  ["cover", "cover"],
  ["stretch", "fill"],
]);
const SNIFF_BYTES = 64 * 1024;

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** Whether the image holds more than one frame (GIF, APNG, WebP, AVIF). */
async function isAnimated(blob) {
  const bytes = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
  if (ascii(bytes, 0, 3) === "GIF") {
    return true;
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return ascii(bytes, 12, 4) === "VP8X" && Boolean(bytes[20] & 0x02);
  }
  if (ascii(bytes, 4, 4) === "ftyp") {
    return ascii(bytes, 8, 24).includes("avis");
  }
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") {
    // An APNG announces itself with an acTL chunk before the first IDAT.
    const view = new DataView(bytes.buffer);
    for (let offset = 8; offset + 8 <= bytes.length; ) {
      const type = ascii(bytes, offset + 4, 4);
      if (type === "acTL") {
        return true;
      }
      if (type === "IDAT") {
        return false;
      }
      offset += 12 + view.getUint32(offset);
    }
  }
  return false;
}

/**
 * A still or animated picture as the wallpaper. It is a plain <img>: a still
 * costs nothing once decoded, with no canvas, timer or frame loop. An
 * animated image stops when its container is hidden; when paused, or frozen
 * because the window lost focus, it is replaced by one snapshot of the frame
 * it was on.
 */
export class ImageRenderer {
  #animated = false;
  #container;
  #fit = "cover";
  #freezeToken = 0;
  #frozen = null;
  #image = null;
  #loadGeneration = 0;
  #objectURL = null;
  #pageActive = true;
  #paused = false;
  #running = true;
  #visible = true;

  init() {
    this.#container = document.createElement("div");
    this.#container.id = "komorebi-image-container";
    this.#container.hidden = true;
    document.body.prepend(this.#container);
  }

  /** A picture never produces frames of its own to measure. */
  get fps() {
    return 0;
  }

  /**
   * @param {Blob} source
   */
  async load(source) {
    const generation = ++this.#loadGeneration;
    const objectURL = URL.createObjectURL(source);
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    image.src = objectURL;
    try {
      await image.decode();
    } catch {
      this.#discard(image, objectURL);
      throw new Error("Image decoding failed");
    }
    const animated = await isAnimated(source).catch(() => false);
    if (generation !== this.#loadGeneration) {
      this.#discard(image, objectURL);
      return false;
    }

    this.#release();
    this.#image = image;
    this.#objectURL = objectURL;
    this.#animated = animated;
    this.#applyFit();
    this.#container.appendChild(image);
    this.#updateVisibility();
    this.#updateAnimation();
    return true;
  }

  updateSettings(settings) {
    this.#fit = settings.fit;
    this.#paused = settings.paused;
    this.#applyFit();
    this.#updateAnimation();
  }

  setPageActive(active) {
    this.#pageActive = active;
    this.#updateVisibility();
  }

  setRunning(running) {
    this.#running = running;
    this.#updateAnimation();
  }

  // A picture has no sound.
  setAudioAllowed() {}

  setAudioDucked() {}

  setVisible(visible) {
    this.#visible = visible;
    this.#updateVisibility();
  }

  destroy() {
    this.#loadGeneration++;
    this.#release();
    this.#container?.remove();
  }

  #applyFit() {
    const fit = FIT_STYLES.get(this.#fit) ?? "cover";
    for (const element of [this.#image, this.#frozen]) {
      if (element) {
        element.style.objectFit = fit;
      }
    }
  }

  #discard(image, objectURL) {
    image.removeAttribute("src");
    URL.revokeObjectURL(objectURL);
  }

  #release() {
    this.#freezeToken++;
    this.#frozen?.remove();
    this.#frozen = null;
    if (this.#image) {
      this.#image.remove();
      this.#discard(this.#image, this.#objectURL);
    }
    this.#image = null;
    this.#objectURL = null;
    this.#animated = false;
  }

  #updateVisibility() {
    this.#container.hidden = !(this.#visible && this.#pageActive);
  }

  #updateAnimation() {
    if (!this.#image || !this.#animated) {
      return;
    }
    if (this.#paused || !this.#running) {
      this.#freeze();
    } else {
      this.#unfreeze();
    }
  }

  async #freeze() {
    if (this.#frozen) {
      return;
    }
    const token = ++this.#freezeToken;
    const image = this.#image;
    try {
      const bitmap = await createImageBitmap(image);
      if (token !== this.#freezeToken || this.#image !== image) {
        bitmap.close();
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("bitmaprenderer").transferFromImageBitmap(bitmap);
      this.#frozen = canvas;
      this.#applyFit();
      this.#container.appendChild(canvas);
      image.hidden = true;
    } catch (error) {
      console.error("Komorebi could not pause the animated image", error);
    }
  }

  #unfreeze() {
    this.#freezeToken++;
    if (this.#frozen) {
      this.#frozen.remove();
      this.#frozen = null;
    }
    if (this.#image) {
      this.#image.hidden = false;
    }
  }
}
