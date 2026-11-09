/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
const VOLUME_PREF = "browser.komorebi.video.volume";
const MUTED_PREF = "browser.komorebi.video.muted";
const DEFAULT_UNMUTE_VOLUME = 0.5;
export class SceneAudioPlayer {
    #active = false;
    #audio;
    #ducked = false;
    #overlayVisible = false;
    #autoplay = false;
    #index = 0;
    #muteButton;
    #overlay;
    #playButton;
    #resumeOnActivate = false;
    #settings = { muted: false, volume: 0.5 };
    #volumeSlider;
    #title;
    #tracks = [];
    init() {
        this.#createAudio();
        this.#createOverlay();
        this.#updatePlayButton();
        this.#updateVolumeControls();
    }
    load(tracks) {
        this.#releaseTracks();
        this.#resumeOnActivate = false;
        this.#tracks = tracks.map(track => ({
            ...track,
            url: URL.createObjectURL(track.blob),
        }));
        this.#index = 0;
        this.#autoplay =
            this.#tracks.length === 1 && !this.#tracks[0]?.startSilent;
        this.#overlay.hidden = this.#tracks.length < 2 || !this.#overlayVisible;
        if (!this.#tracks.length) {
            return;
        }
        this.#selectTrack(0);
        if (this.#autoplay) {
            this.play();
        }
    }
    setActive(active) {
        if (this.#active === active) {
            return;
        }
        this.#active = active;
        if (!active) {
            this.#resumeOnActivate = !this.#audio.paused;
            this.#audio.pause();
            this.#updatePlayButton();
        }
        else if (this.#autoplay || this.#resumeOnActivate) {
            this.play();
        }
    }
    setOverlayVisible(visible) {
        this.#overlayVisible = visible;
        this.#overlay.hidden = !visible || this.#tracks.length < 2;
    }
    setDucked(ducked) {
        this.#ducked = ducked;
        this.#applySettings();
    }
    updateSettings(settings) {
        this.#settings = settings;
        this.#applySettings();
        this.#updateVolumeControls();
    }
    play() {
        if (!this.#active || !this.#tracks.length) {
            return;
        }
        this.#autoplay = false;
        this.#resumeOnActivate = false;
        this.#audio.play().catch(error => {
            if (error.name !== "AbortError") {
                console.error("Komorebi could not play scene audio", error);
            }
        });
        this.#updatePlayButton();
    }
    toggle() {
        if (this.#audio.paused) {
            this.play();
        }
        else {
            this.#audio.pause();
            this.#updatePlayButton();
        }
    }
    next() {
        if (!this.#tracks.length) {
            return;
        }
        this.#selectTrack((this.#index + 1) % this.#tracks.length);
        this.play();
    }
    previous() {
        if (!this.#tracks.length) {
            return;
        }
        this.#selectTrack((this.#index - 1 + this.#tracks.length) % this.#tracks.length);
        this.play();
    }
    destroy() {
        this.#releaseTracks();
        this.#overlay.remove();
    }
    #createAudio() {
        this.#audio = new Audio();
        this.#audio.preload = "auto";
        this.#audio.addEventListener("ended", () => this.next());
    }
    #createOverlay() {
        this.#overlay = document.createElement("section");
        this.#overlay.id = "komorebi-scene-audio";
        this.#overlay.hidden = true;
        const previous = this.#createButton("previous", "komorebi-audio-previous", () => this.previous());
        this.#playButton = this.#createButton("play", "komorebi-audio-play", () => this.toggle());
        const next = this.#createButton("next", "komorebi-audio-next", () => this.next());
        this.#title = document.createElement("span");
        this.#title.className = "komorebi-scene-audio-title";
        const volume = document.createElement("div");
        volume.className = "komorebi-scene-audio-volume";
        this.#muteButton = this.#createButton("mute", "komorebi-audio-mute", () => this.#toggleMute());
        this.#volumeSlider = document.createElement("input");
        this.#volumeSlider.type = "range";
        this.#volumeSlider.min = "0";
        this.#volumeSlider.max = "1";
        this.#volumeSlider.step = "0.05";
        document.l10n.setAttributes(this.#volumeSlider, "komorebi-audio-volume");
        this.#volumeSlider.addEventListener("input", () => this.#setVolume(Number(this.#volumeSlider.value)));
        volume.append(this.#muteButton, this.#volumeSlider);
        this.#overlay.append(previous, this.#playButton, next, this.#title, volume);
        document.body.appendChild(this.#overlay);
    }
    #createButton(action, l10nId, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "komorebi-scene-audio-button";
        button.dataset.action = action;
        document.l10n.setAttributes(button, l10nId);
        button.addEventListener("click", onClick);
        return button;
    }
    #toggleMute() {
        const silent = this.#settings.muted || this.#settings.volume === 0;
        if (silent) {
            if (this.#settings.volume === 0) {
                Services.prefs.setCharPref(VOLUME_PREF, String(DEFAULT_UNMUTE_VOLUME));
            }
            Services.prefs.setBoolPref(MUTED_PREF, false);
        }
        else {
            Services.prefs.setBoolPref(MUTED_PREF, true);
        }
    }
    #setVolume(value) {
        Services.prefs.setCharPref(VOLUME_PREF, String(value));
        if (value > 0 && this.#settings.muted) {
            Services.prefs.setBoolPref(MUTED_PREF, false);
        }
    }
    #updateVolumeControls() {
        const silent = this.#settings.muted || this.#settings.volume === 0;
        this.#muteButton.dataset.state = silent ? "muted" : "on";
        document.l10n.setAttributes(this.#muteButton, silent ? "komorebi-audio-unmute" : "komorebi-audio-mute");
        this.#volumeSlider.value = this.#settings.volume;
        this.#volumeSlider.style.setProperty("--komorebi-fill", `${this.#settings.volume * 100}%`);
    }
    #selectTrack(index) {
        this.#audio.pause();
        this.#index = index;
        const track = this.#tracks[index];
        this.#audio.src = track.url;
        this.#audio.loop = track.loop && this.#tracks.length === 1;
        this.#title.textContent = track.title;
        this.#applySettings();
        this.#updatePlayButton();
    }
    #applySettings() {
        const track = this.#tracks[this.#index];
        this.#audio.muted = this.#settings.muted || this.#ducked;
        this.#audio.volume = Math.max(0, Math.min(1, (track?.volume ?? 1) * this.#settings.volume));
    }
    #updatePlayButton() {
        this.#playButton.dataset.state = this.#audio.paused ? "paused" : "playing";
        document.l10n.setAttributes(this.#playButton, this.#audio.paused
            ? "komorebi-audio-play"
            : "komorebi-audio-pause");
    }
    #releaseTracks() {
        this.#audio.pause();
        this.#audio.removeAttribute("src");
        this.#audio.load();
        for (const track of this.#tracks) {
            URL.revokeObjectURL(track.url);
        }
        this.#tracks = [];
    }
}
