/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { WORKER_SOURCE } from "./ScriptWorker.js";

// SceneScript is written by anonymous authors, so it never runs in this page.
// It runs in a dedicated worker that lives inside an iframe with an opaque
// origin (no allow-same-origin) and a CSP that refuses every request. The
// iframe only creates the worker and hands it one MessagePort; the page talks
// to the worker through that port and nothing else.
const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'";
const FRAME_SCRIPT = `
addEventListener("message", event => {
  if (event.source !== parent || !event.ports[0] || typeof event.data?.source !== "string") {
    return;
  }
  try {
    const url = URL.createObjectURL(new Blob([event.data.source], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onerror = error => {
      error.preventDefault();
      parent.postMessage({ kind: "error", message: String(error.message).slice(0, 200) }, "*");
    };
    worker.postMessage({ port: event.ports[0] }, [event.ports[0]]);
  } catch (error) {
    parent.postMessage({ kind: "error", message: String(error).slice(0, 200) }, "*");
  }
}, { once: true });
`;
const FRAME_STYLE = "position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none";

export class ScriptSandbox {
    #frame = null;
    #port = null;
    #onMessage;
    #onFailure;
    #dead = false;

    constructor({ onMessage, onFailure }) {
        this.#onMessage = onMessage;
        this.#onFailure = onFailure;
    }

    /** Starts the worker and resolves once it has locked itself down. */
    start() {
        return new Promise((resolve, reject) => {
            const frame = document.createElement("iframe");
            frame.setAttribute("sandbox", "allow-scripts");
            frame.setAttribute("aria-hidden", "true");
            frame.style.cssText = FRAME_STYLE;
            frame.srcdoc =
                `<!doctype html><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">` +
                `<script>${FRAME_SCRIPT}</script>`;
            this.#frame = frame;
            const channel = new MessageChannel();
            this.#port = channel.port1;
            const guard = setTimeout(() => {
                this.#fail(new Error("Script sandbox did not start"));
                reject(new Error("Script sandbox did not start"));
            }, 5000);
            const onFrameMessage = event => {
                if (event.source !== frame.contentWindow || event.data?.kind !== "error") {
                    return;
                }
                clearTimeout(guard);
                this.#fail(new Error(String(event.data.message)));
                reject(new Error(String(event.data.message)));
            };
            window.addEventListener("message", onFrameMessage);
            this.#stopListening = () => window.removeEventListener("message", onFrameMessage);
            this.#port.onmessage = event => {
                if (event.data?.t === "hello") {
                    clearTimeout(guard);
                    this.#port.onmessage = message => this.#onMessage(message.data);
                    resolve();
                }
            };
            frame.addEventListener(
                "load",
                () => {
                    frame.contentWindow.postMessage({ source: WORKER_SOURCE }, "*", [channel.port2]);
                },
                { once: true }
            );
            document.body.append(frame);
        });
    }

    #stopListening = () => {};

    post(message) {
        if (!this.#dead) {
            this.#port.postMessage(message);
        }
    }

    get alive() {
        return !this.#dead;
    }

    /** Terminates the worker for good, running or not. */
    terminate() {
        if (this.#dead) {
            return;
        }
        this.#dead = true;
        this.#stopListening();
        try {
            this.#port.close();
        } catch {}
        this.#frame?.remove();
        this.#frame = null;
    }

    #fail(error) {
        this.terminate();
        this.#onFailure?.(error);
    }
}
