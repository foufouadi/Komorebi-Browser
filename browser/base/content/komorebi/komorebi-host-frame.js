/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/* eslint-env mozilla/frame-script */

(function () {
  "use strict";

  Cu.importGlobalProperties(["fetch"]);

  const ROOT_MODULE =
    "chrome://browser/content/komorebi/dist/host/WallpaperHostPage.js";
  const TO_PAGE = "Komorebi:Host:ToPage";
  const TO_PARENT = "Komorebi:Host:FromPage";
  const RELATIVE_IMPORT = /\b(from\s*|import\s*)(["'])(\.{1,2}\/[^"'\n]+)\2/g;
  const blobURLs = [];

  function fromPage(source) {
    return source === content || source === content.window;
  }

  async function readText(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not read ${url}: ${response.status}`);
    }
    return response.text();
  }

  function createBlobURL(text) {
    const url = content.URL.createObjectURL(
      new content.Blob([text], { type: "text/javascript" })
    );
    blobURLs.push(url);
    return url;
  }

  async function bundleModules(rootSpec) {
    const modules = new Map();

    function visit(spec, chain) {
      if (chain.includes(spec)) {
        throw new Error(`Import cycle through ${spec}`);
      }
      if (!modules.has(spec)) {
        modules.set(
          spec,
          load(spec, [...chain, spec]).catch(error => {
            modules.delete(spec);
            throw error;
          })
        );
      }
      return modules.get(spec);
    }

    async function load(spec, chain) {
      const source = await readText(spec);
      const base = Services.io.newURI(spec);
      const dependencies = new Map();
      for (const [, , , specifier] of source.matchAll(RELATIVE_IMPORT)) {
        dependencies.set(
          specifier,
          Services.io.newURI(specifier, null, base).spec
        );
      }
      const resolved = new Map(
        await Promise.all(
          [...dependencies].map(async ([specifier, target]) => [
            specifier,
            await visit(target, chain),
          ])
        )
      );
      return createBlobURL(
        source.replace(
          RELATIVE_IMPORT,
          (match, keyword, quote, specifier) =>
            `${keyword}${quote}${resolved.get(specifier)}${quote}`
        )
      );
    }

    return visit(rootSpec, []);
  }

  function reportFailure(error) {
    sendAsyncMessage(TO_PARENT, {
      dir: "toHost",
      error: String(error?.message ?? error),
      type: "fail",
    });
  }

  async function boot() {
    const doc = content.document;
    try {
      doc.notifyUserGestureActivation();
    } catch (error) {
      console.error("Komorebi could not mark the host page as activated", error);
    }
    const root = await bundleModules(ROOT_MODULE);
    const script = doc.createElement("script");
    script.type = "module";
    script.textContent = `import(${JSON.stringify(root)}).catch(error =>
      window.postMessage(
        { dir: "toHost", type: "fail", error: String(error?.message ?? error) },
        "*"
      )
    );`;
    (doc.head || doc.documentElement).append(script);
  }

  function releaseBlobURLs() {
    for (const url of blobURLs.splice(0)) {
      content.URL.revokeObjectURL(url);
    }
  }

  function collectGarbage() {
    Cu.forceGC();
    Cu.forceCC();
  }

  function onPageMessage(event) {
    if (!fromPage(event.source)) {
      return;
    }
    const data = Cu.waiveXrays(event.data);
    if (data?.dir !== "toHost") {
      return;
    }
    sendAsyncMessage(TO_PARENT, data);
    if (data.type === "ready") {
      releaseBlobURLs();
    } else if (data.type === "result" && data.method === "load") {
      collectGarbage();
    }
  }

  addMessageListener(TO_PAGE, message => {
    content.postMessage({ ...message.data, dir: "toPage" }, "*");
  });
  content.addEventListener("message", onPageMessage);

  const start = () => boot().catch(reportFailure);
  if (content.document.readyState === "loading") {
    content.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
