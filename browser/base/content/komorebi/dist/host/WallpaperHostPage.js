/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { VideoRenderer } from "../../komorebi-video-renderer.js";
import { SceneRenderer } from "../renderer/SceneRenderer.js";
const STYLE = `
html, body {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: transparent;
}
[hidden] {
    display: none !important;
}
canvas, video {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
}
#komorebi-container {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
}
`;
const METHODS = new Set([
    "destroy",
    "load",
    "setAudioAllowed",
    "setAudioDucked",
    "setPageActive",
    "setRunning",
    "setVisible",
    "updateSettings",
]);
const FPS_INTERVAL_MS = 1000;
const pendingReads = new Map();
const shown = {
    scene: { pageActive: true, visible: false },
    video: { pageActive: true, visible: false },
};
let nextReadId = 1;
let fpsTimer = null;
function send(message) {
    window.postMessage({ dir: "toHost", ...message }, "*");
}
function forwardAudio(method, args = []) {
    send({ args, method, type: "audio" });
}
const audioPlayer = {
    destroy: () => forwardAudio("destroy"),
    init: () => forwardAudio("init"),
    load(tracks) {
        forwardAudio("load", [
            tracks.map(({ data, ...track }) => ({
                ...track,
                blob: new Blob([data], { type: track.mimeType }),
            })),
        ]);
    },
    setActive: active => forwardAudio("setActive", [active]),
    setDucked: ducked => forwardAudio("setDucked", [ducked]),
    setOverlayVisible: visible => forwardAudio("setOverlayVisible", [visible]),
    updateSettings: settings => forwardAudio("updateSettings", [settings]),
};
globalThis.MousePosTracker = { _x: undefined, _y: undefined };
globalThis.KomorebiHostBridge = {
    read(source) {
        return new Promise((resolve, reject) => {
            const id = nextReadId++;
            pendingReads.set(id, { reject, resolve });
            send({ id, source, type: "read" });
        });
    },
};
function settleRead({ blob, error, id }) {
    const pending = pendingReads.get(id);
    if (!pending) {
        return;
    }
    pendingReads.delete(id);
    if (error !== undefined || !blob) {
        pending.reject(new Error(error ?? "Read failed"));
        return;
    }
    blob.arrayBuffer().then(pending.resolve, pending.reject);
}
const style = document.createElement("style");
style.textContent = STYLE;
document.head.append(style);
const scene = new SceneRenderer();
const video = new VideoRenderer();
const renderers = { scene, video };
scene.init({ audioPlayer });
video.init();
function reportFps() {
    send({
        type: "fps",
        scene: isShown("scene") ? scene.fps : 0,
        video: isShown("video") ? video.fps : 0,
    });
}
function isShown(target) {
    return shown[target].visible && shown[target].pageActive;
}
function updateReporting() {
    const active = isShown("scene") || isShown("video");
    if (active && fpsTimer === null) {
        fpsTimer = setInterval(reportFps, FPS_INTERVAL_MS);
    }
    else if (!active && fpsTimer !== null) {
        clearInterval(fpsTimer);
        fpsTimer = null;
        send({ type: "fps", scene: 0, video: 0 });
    }
}
function track(target, method, args) {
    if (method === "setVisible") {
        shown[target].visible = Boolean(args[0]);
    }
    else if (method === "setPageActive") {
        shown[target].pageActive = Boolean(args[0]);
    }
    else if (method === "destroy") {
        shown[target].visible = false;
    }
    updateReporting();
}
async function dispatch({ args = [], id, method, target }) {
    const reply = { id, method, target, type: "result" };
    try {
        const renderer = renderers[target];
        if (!renderer || !METHODS.has(method)) {
            throw new Error(`Unknown call ${target}.${method}`);
        }
        track(target, method, args);
        const result = await renderer[method](...args);
        if (method === "load" && target === "scene" && result) {
            shown.scene.visible = true;
            updateReporting();
        }
        if (id !== undefined) {
            send({ ...reply, result });
        }
    }
    catch (error) {
        console.error(`Komorebi ${target}.${method} failed`, error);
        if (id !== undefined) {
            send({ ...reply, error: String(error?.message ?? error) });
        }
    }
}
window.addEventListener("message", event => {
    const message = event.data;
    if ((event.source && event.source !== window) || message?.dir !== "toPage") {
        return;
    }
    switch (message.type) {
        case "call":
            dispatch(message);
            break;
        case "pointer":
            globalThis.MousePosTracker._x = message.x;
            globalThis.MousePosTracker._y = message.y;
            break;
        case "readResult":
            settleRead(message);
            break;
    }
});
send({ type: "ready" });
