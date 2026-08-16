export class SceneAudioPlayer {
    #active = false;
    #audio;
    #autoplay = false;
    #index = 0;
    #overlay;
    #playButton;
    #resumeOnActivate = false;
    #settings = { muted: false, volume: 0.5 };
    #title;
    #tracks = [];
    init() {
        this.#createAudio();
        this.#createOverlay();
        this.#updatePlayButton();
    }
    load(tracks) {
        this.#releaseTracks();
        this.#tracks = tracks.map(track => ({
            ...track,
            url: URL.createObjectURL(new Blob([track.data], { type: track.mimeType })),
        }));
        this.#index = 0;
        this.#autoplay =
            this.#tracks.length === 1 && !this.#tracks[0]?.startSilent;
        this.#overlay.hidden = this.#tracks.length < 2 || !this.#active;
        if (!this.#tracks.length) {
            return;
        }
        this.#selectTrack(0);
        if (this.#autoplay) {
            this.play();
        }
    }
    setActive(active) {
        this.#active = active;
        this.#overlay.hidden = !active || this.#tracks.length < 2;
        if (!active) {
            this.#resumeOnActivate = !this.#audio.paused;
            this.#audio.pause();
            this.#updatePlayButton();
        }
        else if (this.#autoplay || this.#resumeOnActivate) {
            this.play();
        }
    }
    updateSettings(settings) {
        this.#settings = settings;
        this.#applySettings();
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
        const previous = this.#createPreviousButton();
        this.#playButton = this.#createPlayButton();
        const next = this.#createNextButton();
        this.#title = document.createElement("span");
        this.#title.className = "komorebi-scene-audio-title";
        this.#overlay.append(previous, this.#playButton, next, this.#title);
        document.body.appendChild(this.#overlay);
    }
    #createPreviousButton() {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "◀";
        document.l10n.setAttributes(button, "komorebi-audio-previous");
        button.addEventListener("click", () => this.previous());
        return button;
    }
    #createPlayButton() {
        const button = document.createElement("button");
        button.type = "button";
        button.addEventListener("click", () => this.toggle());
        return button;
    }
    #createNextButton() {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "▶";
        document.l10n.setAttributes(button, "komorebi-audio-next");
        button.addEventListener("click", () => this.next());
        return button;
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
        this.#audio.muted = this.#settings.muted;
        this.#audio.volume = Math.max(0, Math.min(1, (track?.volume ?? 1) * this.#settings.volume));
    }
    #updatePlayButton() {
        document.l10n.setAttributes(this.#playButton, this.#audio.paused
            ? "komorebi-audio-play"
            : "komorebi-audio-pause");
        this.#playButton.textContent =
            this.#audio.paused ? "▶" : "Ⅱ";
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
