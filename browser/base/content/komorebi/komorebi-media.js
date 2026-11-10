/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* globals File */

// Images and videos the user adds to the library, by dropping them on it or
// with the Add file button. Each one is copied into its own folder under
// <profile>/komorebi/media, next to a project.json shaped like a Wallpaper
// Engine project, so the library scans, filters and applies it like any other
// and the wallpaper keeps working when the original is moved or deleted.

(function (global) {
  "use strict";

  const IMAGE_TYPES = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp"]);
  const VIDEO_TYPES = new Set(["mp4", "webm", "ogg", "ogv"]);
  const MAX_BYTES = {
    image: 64 * 1024 * 1024,
    video: 1024 * 1024 * 1024,
  };
  const THUMBNAIL_WIDTH = 640;
  const VIDEO_FRAME_TIMEOUT_MS = 6000;
  const MAX_NAME_LENGTH = 80;
  const SNIFF_BYTES = 32;
  const MEDIA_FOLDER = ["komorebi", "media"];

  function root() {
    return PathUtils.join(PathUtils.profileDir, ...MEDIA_FOLDER);
  }

  function extensionOf(name) {
    const dot = name.lastIndexOf(".");
    return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  }

  /** "image", "video", or null for a name this feature does not handle. */
  function classify(name) {
    const extension = extensionOf(name);
    if (IMAGE_TYPES.has(extension)) {
      return "image";
    }
    return VIDEO_TYPES.has(extension) ? "video" : null;
  }

  function matches(bytes, signature, offset = 0) {
    return signature.every((value, index) => bytes[offset + index] === value);
  }

  function ascii(text) {
    return Array.from(text, character => character.charCodeAt(0));
  }

  function brandIsAvif(bytes) {
    const text = String.fromCharCode(...bytes);
    return text.includes("avif") || text.includes("avis");
  }

  // The extension is only a claim: check that the content is what it says.
  function looksLike(kind, bytes) {
    if (kind === "image") {
      return (
        matches(bytes, [0xff, 0xd8, 0xff]) ||
        matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
        matches(bytes, ascii("GIF8")) ||
        (matches(bytes, ascii("RIFF")) && matches(bytes, ascii("WEBP"), 8)) ||
        matches(bytes, ascii("BM")) ||
        (matches(bytes, ascii("ftyp"), 4) && brandIsAvif(bytes))
      );
    }
    return (
      matches(bytes, ascii("ftyp"), 4) ||
      ["moov", "mdat", "free", "wide"].some(box => matches(bytes, ascii(box), 4)) ||
      matches(bytes, [0x1a, 0x45, 0xdf, 0xa3]) ||
      matches(bytes, ascii("OggS"))
    );
  }

  function safeFileName(name, kind) {
    const extension = extensionOf(name);
    const stem = name
      .slice(0, name.length - extension.length - 1)
      .replace(/[^\p{L}\p{N} ._()-]+/gu, "_")
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, MAX_NAME_LENGTH);
    return `${stem || kind}.${extension}`;
  }

  function titleOf(name) {
    const extension = extensionOf(name);
    return name.slice(0, name.length - extension.length - 1) || name;
  }

  function newId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function reject(name, reason, details = {}) {
    return { details, name, reason };
  }

  async function renderThumbnail(source, mimeType, destination) {
    const bitmap = await createImageBitmap(source, {
      resizeQuality: "high",
      resizeWidth: THUMBNAIL_WIDTH,
    });
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("bitmaprenderer").transferFromImageBitmap(bitmap);
      const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, mimeType, 0.85)
      );
      await IOUtils.write(destination, new Uint8Array(await blob.arrayBuffer()));
    } finally {
      bitmap.close?.();
    }
  }

  // The first decodable frame of a video. A video this window cannot decode
  // simply gets no thumbnail and a neutral card.
  async function renderVideoThumbnail(filePath, destination) {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(filePath);
    video.src = Services.io.newFileURI(file).spec;
    try {
      await new Promise((resolve, reject_) => {
        const timer = window.setTimeout(
          () => reject_(new Error("Video frame timed out")),
          VIDEO_FRAME_TIMEOUT_MS
        );
        video.addEventListener(
          "loadeddata",
          () => {
            video.addEventListener(
              "seeked",
              () => {
                window.clearTimeout(timer);
                resolve();
              },
              { once: true }
            );
            video.currentTime = Math.min(1, (video.duration || 0) / 10);
          },
          { once: true }
        );
        video.addEventListener(
          "error",
          () => {
            window.clearTimeout(timer);
            reject_(new Error("Video decoding failed"));
          },
          { once: true }
        );
        video.load();
      });
      await renderThumbnail(video, "image/jpeg", destination);
      return true;
    } catch (error) {
      console.warn("Komorebi could not take a video thumbnail", error);
      return false;
    } finally {
      video.removeAttribute("src");
      video.load();
    }
  }

  async function sizeOf(path) {
    const info = await IOUtils.stat(path);
    return info.type === "directory" ? null : info.size;
  }

  /**
   * Copies one file into the library.
   *
   * @param {{ name: string, path?: string, file?: File }} item
   *   A file on disk, or a File without a path (dragged out of a web page).
   * @returns {Promise<object>} { added: { directory, title, type } } or
   *   { rejected: { name, reason, details } }
   */
  async function addOne({ name, path, file }) {
    let size;
    if (path) {
      size = await sizeOf(path).catch(() => undefined);
      if (size === null) {
        return { rejected: reject(name, "folder") };
      }
      if (size === undefined) {
        return { rejected: reject(name, "failed") };
      }
    } else {
      size = file.size;
    }
    const kind = classify(name);
    if (!kind) {
      return { rejected: reject(name, "unsupported") };
    }
    if (size > MAX_BYTES[kind]) {
      return {
        rejected: reject(name, `too-large-${kind}`, {
          limit: MAX_BYTES[kind] / (1024 * 1024),
        }),
      };
    }

    const directory = PathUtils.join(root(), newId());
    const fileName = safeFileName(name, kind);
    const target = PathUtils.join(directory, fileName);
    try {
      await IOUtils.makeDirectory(directory, { createAncestors: true });
      if (path) {
        await IOUtils.copy(path, target);
      } else {
        await IOUtils.write(target, new Uint8Array(await file.arrayBuffer()));
      }
      const head = await IOUtils.read(target, { maxBytes: SNIFF_BYTES });
      if (!looksLike(kind, head)) {
        await IOUtils.remove(directory, { recursive: true });
        return { rejected: reject(name, "invalid") };
      }

      const project = {
        file: fileName,
        komorebi: { added: true },
        tags: [],
        title: titleOf(name),
        type: kind,
      };
      // Photos stay JPEG; the other formats may hold transparency.
      const photo =
        kind === "video" || ["jpg", "jpeg"].includes(extensionOf(fileName));
      const preview = photo ? "preview.jpg" : "preview.png";
      const previewPath = PathUtils.join(directory, preview);
      let thumbnail = false;
      if (kind === "image") {
        const blob = await fileAsBlob(target);
        try {
          await renderThumbnail(blob, photo ? "image/jpeg" : "image/png", previewPath);
          thumbnail = true;
        } catch (error) {
          await IOUtils.remove(directory, { recursive: true });
          console.warn("Komorebi could not decode the image", error);
          return { rejected: reject(name, "invalid") };
        }
      } else {
        thumbnail = await renderVideoThumbnail(target, previewPath);
      }
      if (thumbnail) {
        project.preview = preview;
      }
      await IOUtils.writeJSON(PathUtils.join(directory, "project.json"), project);
      return { added: { directory, title: project.title, type: kind } };
    } catch (error) {
      console.error(`Komorebi could not add ${name}`, error);
      await IOUtils.remove(directory, { recursive: true }).catch(() => {});
      return { rejected: reject(name, "failed") };
    }
  }

  function fileAsBlob(path) {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    return File.createFromNsIFile(file);
  }

  /**
   * @param {Array<{ name: string, path?: string, file?: File }>} items
   * @returns {Promise<{ added: object[], rejected: object[] }>}
   */
  async function addFiles(items) {
    await IOUtils.makeDirectory(root(), { createAncestors: true });
    const result = { added: [], rejected: [] };
    for (const item of items) {
      const outcome = await addOne(item);
      if (outcome.added) {
        result.added.push(outcome.added);
      } else {
        result.rejected.push(outcome.rejected);
      }
    }
    return result;
  }

  function isMediaDirectory(directory) {
    return (
      typeof directory === "string" &&
      PathUtils.parent(directory)?.toLowerCase() === root().toLowerCase()
    );
  }

  /** Deletes the copy of an added file; the original is never touched. */
  async function remove(directory) {
    if (!isMediaDirectory(directory)) {
      throw new Error("Not an added wallpaper");
    }
    await IOUtils.remove(directory, { ignoreAbsent: true, recursive: true });
  }

  global.KomorebiMedia = {
    IMAGE_TYPES,
    VIDEO_TYPES,
    addFiles,
    classify,
    isMediaDirectory,
    remove,
    root,
  };
})(this);
