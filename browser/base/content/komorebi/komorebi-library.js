/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

(function (global) {
  "use strict";

  const LEGACY_LIBRARY_PREF = "browser.komorebi.libraryPath";
  const LIBRARY_SOURCES_PREF = "browser.komorebi.librarySources";
  const DISMISSED_SOURCES_PREF = "browser.komorebi.dismissedSources";
  const ACTIVE_PREF = "browser.komorebi.activeWallpaper";
  const ACTIVE_PROJECT_PREF = "browser.komorebi.activeProject";
  const FAVORITES_PREF = "browser.komorebi.favorites";
  const HIDDEN_PROJECTS_PREF = "browser.komorebi.hiddenProjects";
  const POWER_MODE_PREF = "browser.komorebi.powerMode";
  const MATCH_THEME_PREF = "browser.komorebi.matchTheme";
  const CONTENT_SCHEME_PREF = "browser.komorebi.contentScheme";
  const KOMOREBI_BRANCH = "browser.komorebi.";
  const VIDEO_PREF = "browser.komorebi.video.";
  const NEWTAB_PREF = "browser.newtabpage.activity-stream.";
  const WIDGET_ID = "komorebi-toolbar-button";
  const SUPPORTED_VIDEO_TYPES = new Set(["mp4", "webm", "ogg", "ogv"]);
  const SUPPORTED_IMAGE_TYPES = global.KomorebiMedia.IMAGE_TYPES;
  const MEDIA_FILE_PATTERN = [
    ...SUPPORTED_IMAGE_TYPES,
    ...SUPPORTED_VIDEO_TYPES,
  ]
    .map(type => `*.${type}`)
    .join("; ");
  const NOTICE_MS = 12000;
  const DELETE_RETRIES = 5;
  const DELETE_RETRY_MS = 250;
  const FIT_MODES = new Set(["contain", "cover", "stretch"]);
  const POWER_MODES = new Map([
    ["performance", 60],
    ["balanced", 30],
    ["eco", 15],
  ]);
  const DEFAULT_POWER_MODE = "balanced";
  const SCAN_CONCURRENCY = 24;
  const USAGE_INTERVAL_MS = 2000;
  const STEAM_FALLBACK_PATH = "C:\\Program Files (x86)\\Steam";
  const STEAM_PROJECT_FOLDERS = [
    ["steamapps", "workshop", "content", "431960"],
    ["steamapps", "common", "wallpaper_engine", "projects", "myprojects"],
    ["steamapps", "common", "wallpaper_engine", "projects", "defaultprojects"],
  ];
  const PAGES = [
    "wallpapers",
    "folders",
    "performance",
    "sound",
    "appearance",
    "browser",
  ];
  const CUSTOM_FPS_PREF = "browser.komorebi.customFPS";
  const EFFECTS_PREF = "browser.komorebi.effects";
  const RENDER_SCALE_PREF = "browser.komorebi.renderScale";
  const PAUSE_BACKGROUND_PREF = "browser.komorebi.pauseInBackground";
  const MUSIC_SCOPE_PREF = "browser.komorebi.musicScope";
  const MUSIC_BACKGROUND_PREF = "browser.komorebi.pauseMusicInBackground";
  const TAB_AUDIO_PREF = "browser.komorebi.muteForTabAudio";
  const SEARCH_WALLPAPER_PREF = "browser.komorebi.searchWallpaper";
  const SEARCH_OPACITY_PREF = "browser.komorebi.searchBlockOpacity";
  const POWER_MODE_ORDER = ["eco", "balanced", "performance", "custom"];
  const RENDERER_PREFS = new Set([
    POWER_MODE_PREF,
    CUSTOM_FPS_PREF,
    EFFECTS_PREF,
    RENDER_SCALE_PREF,
  ]);
  const RENDER_SCALES = [1, 0.75, 0.5];
  const FILTERS = ["none", "grayscale", "sepia", "invert"];
  const MUSIC_SCOPES = ["newtab", "search", "everywhere"];
  const SEARCH_MODES = ["full", "off"];
  const DEFAULT_CUSTOM_FPS = 60;
  const MIN_CUSTOM_FPS = 10;
  const MAX_CUSTOM_FPS = 144;
  const MIN_SPEED = 0.25;
  const MAX_SPEED = 2;
  const FILTER_OPTIONS = FILTERS.map(name => [name, `komorebi-filter-${name}`]);
  const MUSIC_SCOPE_OPTIONS = MUSIC_SCOPES.map(name => [
    name,
    `komorebi-scope-${name}`,
  ]);
  const SEARCH_MODE_OPTIONS = SEARCH_MODES.map(name => [
    name,
    `komorebi-search-${name}`,
  ]);
  const RESOLUTION_OPTIONS = RENDER_SCALES.map(scale => [
    String(scale),
    `komorebi-resolution-${scale * 100}`,
  ]);
  const RESET_PREFS = [
    POWER_MODE_PREF,
    CUSTOM_FPS_PREF,
    EFFECTS_PREF,
    RENDER_SCALE_PREF,
    PAUSE_BACKGROUND_PREF,
    MUSIC_SCOPE_PREF,
    MUSIC_BACKGROUND_PREF,
    TAB_AUDIO_PREF,
    SEARCH_WALLPAPER_PREF,
    MATCH_THEME_PREF,
    ...["fit", "speed", "mirror", "filter", "volume", "muted"].map(
      name => `${VIDEO_PREF}${name}`
    ),
  ];
  const COMPACT_PREF = "browser.komorebi.compact";
  const SLEEP_PREF = "browser.komorebi.sleepAfterMinutes";
  const SORT_PREF = "browser.komorebi.librarySort";
  const SORT_OPTIONS = [
    ["recent", "komorebi-sort-recent"],
    ["oldest", "komorebi-sort-oldest"],
    ["name", "komorebi-sort-name"],
    ["favorites", "komorebi-sort-favorites"],
  ];
  const SLEEP_OPTIONS = [
    ["0", "komorebi-sleep-off"],
    ["15", "komorebi-sleep-15"],
    ["30", "komorebi-sleep-30"],
    ["60", "komorebi-sleep-60"],
  ];

  let config;
  let renderers;
  let dialog;
  let grid;
  let emptyState;
  let emptyText;
  let emptyAddButton;
  let welcome;
  let welcomeSteam;
  let nowBlock;
  let nowPreview;
  let nowTitle;
  let detail;
  let detailPreview;
  let detailTitle;
  let detailType;
  let detailOpen = false;
  let pageTitle;
  let pageDescription;
  let foldersEmpty;
  let controlCount = 0;
  let librarySources;
  let steamSources = [];
  let steamReady = Promise.resolve();
  let projects = [];
  let favorites;
  let hiddenProjects;
  let searchInput;
  let typeValue = "all";
  let tagFilter;
  let sortSelect;
  let favoritesFilter;
  let unsupportedFilter;
  let foldersList;
  let pages = {};
  let activePage = "wallpapers";
  let applyingPath = null;
  let applyToken = 0;
  let currentFilePath = null;
  let currentProject = null;
  let hasWallpaper = false;
  let poster = null;
  let scanning = false;
  let scanToken = 0;
  let settingsSync = [];
  let usageTimer = null;
  let usageSample = null;
  let usageBusy = false;
  let usageValues;
  let notice;
  let noticeTimer = null;
  let dropDepth = 0;

  function getPowerMode() {
    const mode = Services.prefs.getStringPref(
      POWER_MODE_PREF,
      DEFAULT_POWER_MODE
    );
    return POWER_MODE_ORDER.includes(mode) ? mode : DEFAULT_POWER_MODE;
  }

  function getVideoSettings() {
    const prefs = Services.prefs;
    const fit = prefs.getStringPref(`${VIDEO_PREF}fit`, "cover");
    const volume = prefs.getFloatPref(`${VIDEO_PREF}volume`, 0.5);
    const speed = Number(prefs.getStringPref(`${VIDEO_PREF}speed`, "1"));
    const renderScale = Number(prefs.getStringPref(RENDER_SCALE_PREF, "1"));
    const filter = prefs.getStringPref(`${VIDEO_PREF}filter`, "none");
    const customFPS = Math.max(
      MIN_CUSTOM_FPS,
      Math.min(
        MAX_CUSTOM_FPS,
        prefs.getIntPref(CUSTOM_FPS_PREF, DEFAULT_CUSTOM_FPS)
      )
    );
    const powerMode = getPowerMode();
    return {
      customFPS,
      effects: prefs.getBoolPref(EFFECTS_PREF, true),
      filter: FILTERS.includes(filter) ? filter : "none",
      fit: FIT_MODES.has(fit) ? fit : "cover",
      maxFPS: powerMode === "custom" ? customFPS : POWER_MODES.get(powerMode),
      mirror: prefs.getBoolPref(`${VIDEO_PREF}mirror`, false),
      muted: prefs.getBoolPref(`${VIDEO_PREF}muted`, false),
      paused: prefs.getBoolPref(`${VIDEO_PREF}paused`, false),
      powerMode,
      renderScale: RENDER_SCALES.includes(renderScale) ? renderScale : 1,
      speed: Number.isFinite(speed)
        ? Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed))
        : 1,
      volume: Math.max(0, Math.min(1, volume)),
    };
  }

  function loadStringSet(pref) {
    try {
      const values = JSON.parse(Services.prefs.getStringPref(pref, "[]"));
      return new Set(Array.isArray(values) ? values : []);
    } catch (error) {
      console.error(`Komorebi could not read ${pref}`, error);
      return new Set();
    }
  }

  function saveStringSet(pref, set) {
    Services.prefs.setStringPref(pref, JSON.stringify([...set]));
  }

  function saveFavorites() {
    saveStringSet(FAVORITES_PREF, favorites);
  }

  function saveHiddenProjects() {
    saveStringSet(HIDDEN_PROJECTS_PREF, hiddenProjects);
  }

  function create(tag, className) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    return element;
  }

  function normalizeSourcePath(path) {
    return path.replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
  }

  function resolveAssetPath(directory, path) {
    if (
      typeof path !== "string" ||
      PathUtils.isAbsolute(path) ||
      path.split(/[\\/]/).includes("..")
    ) {
      return null;
    }
    return PathUtils.join(directory, path);
  }

  function toFileURI(path) {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    return Services.io.newFileURI(file).spec;
  }

  // Returns a `file://` URI for the local Wallpaper Engine `assets/` folder
  // (parent of `materials/`, `shaders/`, and `effects/`), found by walking
  // up from a wallpaper's own directory to the enclosing `steamapps` folder.
  // Consumers (SceneLoader) append `materials/…` or `shaders/…` themselves
  // to fetch textures and stock shader headers that are missing from the
  // wallpaper's own .pkg.
  async function findWallpaperEngineAssetRoot(directory) {
    let current = directory;
    while (current && PathUtils.parent(current) !== current) {
      if (PathUtils.filename(current).toLowerCase() === "steamapps") {
        const assets = PathUtils.join(
          current,
          "common",
          "wallpaper_engine",
          "assets"
        );
        if (await IOUtils.exists(assets)) {
          return `${toFileURI(assets).replace(/\/$/, "")}/`;
        }
      }
      current = PathUtils.parent(current);
    }
    return null;
  }

  function readSteamPath() {
    if (Services.appinfo.OS !== "WINNT") {
      return null;
    }
    try {
      const key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(
        Ci.nsIWindowsRegKey
      );
      key.open(
        Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER,
        "Software\\Valve\\Steam",
        Ci.nsIWindowsRegKey.ACCESS_READ
      );
      try {
        return key.readStringValue("SteamPath");
      } finally {
        key.close();
      }
    } catch (error) {
      return null;
    }
  }

  async function detectSteamLibraries() {
    try {
      if (Services.appinfo.OS !== "WINNT") {
        return [];
      }
      const steamPath = (readSteamPath() || STEAM_FALLBACK_PATH).replace(
        /\//g,
        "\\"
      );
      const libraries = new Map([[steamPath.toLowerCase(), steamPath]]);
      try {
        const manifest = await IOUtils.readUTF8(
          PathUtils.join(steamPath, "steamapps", "libraryfolders.vdf")
        );
        for (const match of manifest.matchAll(/"path"\s+"([^"]+)"/g)) {
          const library = match[1].replace(/\\\\/g, "\\");
          libraries.set(library.toLowerCase(), library);
        }
      } catch (error) {
        // No manifest: only the Steam folder itself is a candidate.
      }

      const candidates = [...libraries.values()].flatMap(library =>
        STEAM_PROJECT_FOLDERS.map(parts => PathUtils.join(library, ...parts))
      );
      const exists = await Promise.all(
        candidates.map(path => IOUtils.exists(path).catch(() => false))
      );
      return candidates.filter((path, index) => exists[index]);
    } catch (error) {
      return [];
    }
  }

  async function mergeSteamSources() {
    steamSources = await detectSteamLibraries();
    const dismissed = loadStringSet(DISMISSED_SOURCES_PREF);
    const known = new Set(librarySources.map(normalizeSourcePath));
    let changed = false;
    for (const path of steamSources) {
      const key = normalizeSourcePath(path);
      if (known.has(key) || dismissed.has(key)) {
        continue;
      }
      known.add(key);
      librarySources.push(path);
      changed = true;
    }
    if (changed) {
      saveLibrarySources();
    }
  }

  function parseSchemeColor(value) {
    if (typeof value !== "string") {
      return null;
    }
    const channels = value.trim().split(/\s+/).slice(0, 3).map(Number);
    if (channels.length < 3 || channels.some(channel => !Number.isFinite(channel))) {
      return null;
    }
    const [r, g, b] = channels.map(channel =>
      Math.round(Math.max(0, Math.min(1, channel)) * 255)
    );
    return r || g || b ? { r, g, b } : null;
  }

  function luma({ r, g, b }) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  function mixColors(from, to, amount) {
    return {
      r: Math.round(from.r + (to.r - from.r) * amount),
      g: Math.round(from.g + (to.g - from.g) * amount),
      b: Math.round(from.b + (to.b - from.b) * amount),
    };
  }

  function cssColor({ r, g, b }) {
    return `rgb(${r} ${g} ${b})`;
  }

  async function samplePreview(previewPath) {
    try {
      const image = document.createElement("img");
      image.src = toFileURI(previewPath);
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, 32, 32);
      const { data } = context.getImageData(0, 0, 32, 32);
      let count = 0;
      let weight = 0;
      const weighted = { r: 0, g: 0, b: 0 };
      const plain = { r: 0, g: 0, b: 0 };
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] < 128) {
          continue;
        }
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const max = Math.max(r, g, b);
        const saturation = max ? (max - Math.min(r, g, b)) / max : 0;
        const pixelWeight = saturation * (max / 255);
        count++;
        weight += pixelWeight;
        plain.r += r;
        plain.g += g;
        plain.b += b;
        weighted.r += r * pixelWeight;
        weighted.g += g * pixelWeight;
        weighted.b += b * pixelWeight;
      }
      if (!count) {
        return null;
      }
      const average = {
        r: Math.round(plain.r / count),
        g: Math.round(plain.g / count),
        b: Math.round(plain.b / count),
      };
      const color =
        weight >= count * 0.05
          ? {
              r: Math.round(weighted.r / weight),
              g: Math.round(weighted.g / weight),
              b: Math.round(weighted.b / weight),
            }
          : average;
      return { color, luminance: luma(average) };
    } catch (error) {
      console.error("Komorebi could not read the preview colors", error);
      return null;
    }
  }

  async function ensureAccent(project) {
    if (project.accent) {
      return;
    }
    const sample = project.previewPath
      ? await samplePreview(project.previewPath)
      : null;
    const color = project.scheme || sample?.color;
    if (!color) {
      return;
    }
    project.accent = {
      ...color,
      light: (sample?.luminance ?? luma(color)) > 0.5,
    };
  }

  function readableAccent(accent, lightTint) {
    let color = { r: accent.r, g: accent.g, b: accent.b };
    const target = lightTint ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    for (let step = 0; step < 10; step++) {
      const value = luma(color);
      if (lightTint ? value <= 0.45 : value >= 0.5) {
        break;
      }
      color = mixColors(color, target, 0.12);
    }
    return color;
  }

  function applyTheme(project) {
    const root = document.documentElement;
    const properties = [
      "--komorebi-accent",
      "--komorebi-accent-text",
      "--komorebi-tint",
      "--komorebi-text",
    ];
    const accent = project?.accent;
    if (!accent) {
      for (const property of properties) {
        root.style.removeProperty(property);
      }
      root.removeAttribute("komorebi-tint");
      root.removeAttribute("komorebi-match-theme");
      Services.prefs.setStringPref(CONTENT_SCHEME_PREF, "");
      return;
    }
    const lightTint = Boolean(accent.light);
    const tint = lightTint
      ? mixColors(accent, { r: 255, g: 255, b: 255 }, 0.82)
      : mixColors(accent, { r: 0, g: 0, b: 0 }, 0.78);
    const readable = readableAccent(accent, lightTint);
    root.style.setProperty("--komorebi-accent", cssColor(readable));
    root.style.setProperty(
      "--komorebi-accent-text",
      luma(readable) > 0.55 ? "rgb(0 0 0)" : "rgb(255 255 255)"
    );
    root.style.setProperty("--komorebi-tint", cssColor(tint));
    root.style.setProperty(
      "--komorebi-text",
      lightTint ? "rgb(0 0 0)" : "rgb(255 255 255)"
    );
    root.setAttribute("komorebi-tint", lightTint ? "light" : "dark");
    const matchTheme = Services.prefs.getBoolPref(MATCH_THEME_PREF, true);
    root.toggleAttribute("komorebi-match-theme", matchTheme);
    Services.prefs.setStringPref(
      CONTENT_SCHEME_PREF,
      matchTheme ? (lightTint ? "light" : "dark") : ""
    );
  }

  function showPoster(previewPath) {
    if (!poster) {
      poster = document.createElement("img");
      poster.id = "komorebi-poster";
      poster.alt = "";
      poster.decoding = "async";
      document.body.prepend(poster);
    }
    if (previewPath) {
      poster.src = toFileURI(previewPath);
      poster.hidden = false;
    } else {
      poster.removeAttribute("src");
      poster.hidden = true;
    }
  }

  function removePoster() {
    poster?.remove();
    poster = null;
  }

  async function readProject(directory) {
    const projectPath = PathUtils.join(directory, "project.json");
    if (!(await IOUtils.exists(projectPath))) {
      return null;
    }

    try {
      const project = await IOUtils.readJSON(projectPath);
      // Wallpaper Engine's own exporter isn't consistent about the casing
      // of "type" (seen in the wild: "Scene" as well as "scene"). Every
      // comparison below and in loadProject() is a strict `=== "scene"` /
      // `=== "video"` (and "image"), so a capitalized type silently fell through to the
      // video-fallback path with the scene's own "scene.json" as if it
      // were a video file ("Video request failed (.../scene.json)").
      project.type = (project.type || "").toLowerCase();
      const { lastModified: addedAt } = await IOUtils.stat(projectPath);
      const extension = (project.file || "")
        .split(/[\\/]/)
        .pop()
        .split(".")
        .pop()
        .toLowerCase();
      const videoSupported =
        project.type === "video" && SUPPORTED_VIDEO_TYPES.has(extension);
      const imageSupported =
        project.type === "image" && SUPPORTED_IMAGE_TYPES.has(extension);
      const sceneFile = project.type === "scene" ? project.file : null;
      const expectedPackage = sceneFile?.replace(/\.[^./\\]+$/, ".pkg");
      const packageFiles =
        project.type === "scene"
          ? (await IOUtils.getChildren(directory)).filter(path =>
              path.toLowerCase().endsWith(".pkg")
            )
          : [];
      const packagePath = packageFiles.find(
        path =>
          PathUtils.filename(path).toLocaleLowerCase() ===
          expectedPackage?.toLocaleLowerCase()
      );
      let packageIssue = null;
      if (project.type === "scene" && !packagePath) {
        packageIssue = packageFiles.length ? "mismatch" : "missing";
      }
      const filePath =
        project.type === "scene"
          ? packagePath || null
          : resolveAssetPath(directory, project.file);
      const previewPath = resolveAssetPath(directory, project.preview);
      const sceneSupported =
        project.type === "scene" &&
        !packageIssue &&
        Boolean(filePath) &&
        (await IOUtils.exists(filePath));

      return {
        directory,
        filePath,
        id: PathUtils.filename(directory),
        packageFiles: packageFiles.map(path => PathUtils.filename(path)),
        packageIssue,
        addedAt,
        previewPath,
        scheme: parseSchemeColor(
          project.general?.properties?.schemecolor?.value
        ),
        sceneFile,
        supported:
          sceneSupported ||
          ((videoSupported || imageSupported) && Boolean(filePath)),
        tags: Array.isArray(project.tags) ? project.tags : [],
        title: project.title || PathUtils.filename(directory),
        type: project.type || "unknown",
      };
    } catch (error) {
      console.error(`Komorebi could not read ${projectPath}`, error);
      return null;
    }
  }

  async function mapLimit(items, limit, task) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from(
      { length: Math.min(limit, items.length) },
      async () => {
        while (next < items.length) {
          const index = next++;
          results[index] = await task(items[index]);
        }
      }
    );
    await Promise.all(workers);
    return results;
  }

  async function listCandidates(path) {
    try {
      const rootProject = await readProject(path);
      if (rootProject) {
        return { rootProject, children: [] };
      }
      return {
        rootProject: null,
        children: await IOUtils.getChildren(path, { ignoreAbsent: true }),
      };
    } catch (error) {
      console.error(`Komorebi could not scan ${path}`, error);
      return { rootProject: null, children: [] };
    }
  }

  async function scanSources(sources) {
    const listings = await Promise.all(sources.map(listCandidates));
    const roots = listings.map(listing => listing.rootProject).filter(Boolean);
    const children = listings.flatMap(listing => listing.children);
    const scanned = await mapLimit(children, SCAN_CONCURRENCY, readProject);
    return [...roots, ...scanned.filter(Boolean)];
  }

  async function scanProjects() {
    await steamReady;
    // The folder of added files is always scanned, whatever the user does
    // with the folder list.
    const scannedProjects = await scanSources([
      ...librarySources,
      global.KomorebiMedia.root(),
    ]);
    projects = [
      ...new Map(
        scannedProjects
          .filter(project => !hiddenProjects.has(project.directory))
          .map(project => [project.directory, project])
      ).values(),
    ];
  }

  function saveLibrarySources() {
    Services.prefs.setStringPref(
      LIBRARY_SOURCES_PREF,
      JSON.stringify(librarySources)
    );
  }

  function loadLibrarySources(defaultPath) {
    try {
      const sources = JSON.parse(
        Services.prefs.getStringPref(LIBRARY_SOURCES_PREF, "[]")
      );
      if (Array.isArray(sources) && sources.length) {
        return [...new Set(sources.filter(path => typeof path === "string"))];
      }
    } catch (error) {
      console.error("Komorebi could not read the wallpaper sources", error);
    }

    const legacyPath = Services.prefs.getStringPref(
      LEGACY_LIBRARY_PREF,
      defaultPath
    );
    return [legacyPath];
  }

  function loadActiveProject() {
    try {
      const stored = JSON.parse(
        Services.prefs.getStringPref(ACTIVE_PROJECT_PREF, "")
      );
      if (
        stored &&
        typeof stored.filePath === "string" &&
        typeof stored.directory === "string" &&
        ["scene", "video", "image"].includes(stored.type)
      ) {
        return { ...stored, tags: stored.tags || [] };
      }
    } catch (error) {
      // No stored wallpaper, or an unreadable value.
    }
    return null;
  }

  function saveActiveProject(project) {
    const {
      directory,
      filePath,
      id,
      previewPath,
      sceneFile,
      title,
      type,
      tags,
      supported,
      accent,
    } = project;
    Services.prefs.setStringPref(
      ACTIVE_PROJECT_PREF,
      JSON.stringify({
        directory,
        filePath,
        id,
        previewPath,
        sceneFile,
        title,
        type,
        tags,
        supported,
        accent: accent || null,
      })
    );
  }

  async function loadProject(project) {
    if (project.type === "scene") {
      const applied = await renderers.scene.load({
        assetRoot: await findWallpaperEngineAssetRoot(project.directory),
        packageSource: toFileURI(project.filePath),
        sceneFile: project.sceneFile,
      });
      if (applied) {
        renderers.video.setVisible(false);
        renderers.image.setVisible(false);
        renderers.scene.setVisible(true);
      }
      return applied;
    }

    if (project.type === "image") {
      const applied = await renderers.image.load(toFileURI(project.filePath));
      if (applied) {
        renderers.scene.setVisible(false);
        renderers.video.setVisible(false);
        renderers.image.setVisible(true);
      }
      return applied;
    }

    const applied = await renderers.video.load(toFileURI(project.filePath));
    if (applied) {
      renderers.scene.setVisible(false);
      renderers.image.setVisible(false);
      renderers.video.setVisible(true);
    }
    return applied;
  }

  async function applyProject(project, { persist }) {
    const token = ++applyToken;
    project.loadError = false;
    currentFilePath = project.filePath;
    showPoster(project.previewPath);
    config.setWallpaperSelected(true);
    const themeReady = ensureAccent(project)
      .then(() => {
        if (token === applyToken) {
          applyTheme(project);
        }
      })
      .catch(error => console.error("Komorebi could not match the theme", error));
    try {
      const applied = await loadProject(project);
      if (token !== applyToken) {
        if (applied && !hasWallpaper) {
          hideRenderers();
        }
        return false;
      }
      if (!applied) {
        return false;
      }
      await themeReady;
      hasWallpaper = true;
      currentProject = project;
      if (persist) {
        saveActiveProject(project);
      }
      return true;
    } catch (error) {
      project.loadError = true;
      throw error;
    } finally {
      if (token === applyToken) {
        removePoster();
        if (!hasWallpaper) {
          currentFilePath = null;
          config.setWallpaperSelected(false);
          applyTheme(null);
        } else if (currentProject) {
          currentFilePath = currentProject.filePath;
          applyTheme(currentProject);
        }
        if (dialog) {
          renderProjects();
        }
      }
    }
  }

  function hideRenderers() {
    renderers.scene.setVisible(false);
    renderers.video.setVisible(false);
    renderers.image.setVisible(false);
  }

  function clearWallpaper() {
    applyToken++;
    applyingPath = null;
    hasWallpaper = false;
    currentProject = null;
    currentFilePath = null;
    removePoster();
    hideRenderers();
    renderers.scene.unload();
    renderers.video.unload();
    config.setWallpaperSelected(false);
    applyTheme(null);
    if (dialog) {
      renderProjects();
    }
  }

  function removeWallpaper() {
    clearWallpaper();
    Services.prefs.clearUserPref(ACTIVE_PROJECT_PREF);
    Services.prefs.clearUserPref(ACTIVE_PREF);
  }

  function syncActiveProject() {
    const stored = loadActiveProject();
    if (!stored) {
      if (hasWallpaper || currentFilePath) {
        clearWallpaper();
      }
      return;
    }
    if (
      stored.filePath === currentFilePath ||
      stored.filePath === applyingPath
    ) {
      return;
    }
    applyProject(stored, { persist: false }).catch(error =>
      console.error("Komorebi could not load the active wallpaper", error)
    );
  }

  async function restoreFromLegacyPref(path) {
    await scanProjects();
    const project = projects.find(item => item.filePath === path);
    if (project) {
      await applyProject(project, { persist: true });
    }
  }

  async function applyFromCard(card, project) {
    if (applyingPath === project.filePath) {
      return;
    }
    applyingPath = project.filePath;
    card.classList.add("loading");
    card.setAttribute("aria-busy", "true");
    try {
      if (await applyProject(project, { persist: true })) {
        dialog.close();
      }
    } catch (error) {
      console.error("Komorebi could not apply the wallpaper", error);
    } finally {
      if (applyingPath === project.filePath) {
        applyingPath = null;
      }
      renderProjects();
    }
  }

  function onCardSelect(card, project) {
    if (project.filePath === currentFilePath) {
      setDetailOpen(!detailOpen);
      return;
    }
    applyFromCard(card, project);
  }

  function createCard(project) {
    const current = project.filePath === currentFilePath;
    const card = create("article", "komorebi-wallpaper-card");
    card.classList.toggle("active", current);
    card.classList.toggle("loading", project.filePath === applyingPath);
    card.toggleAttribute("aria-busy", project.filePath === applyingPath);
    card.komorebiProject = project;
    card.addEventListener("contextmenu", event => {
      event.preventDefault();
      openProjectContextMenu(project, event);
    });

    const selectButton = create("button", "komorebi-wallpaper-select");
    selectButton.type = "button";
    // Projects marked unsupported still get a working select button: most
    // of them are genuine `type: "scene"` projects like any other, just
    // missing/mismatched their .pkg file (packageIssue) rather than being a
    // fundamentally different format — trying anyway surfaces the real
    // error (see SceneLoader's load errors) instead of hiding it behind a
    // dead button. Only "web"/"application" project types are a truly
    // different, unimplemented rendering path (see docs/lacunes-connues.md).
    selectButton.disabled = !project.filePath;

    const previewFrame = create("span", "komorebi-wallpaper-preview-frame");
    previewFrame.classList.toggle("empty", !project.previewPath);
    previewFrame.dataset.type = project.type;
    if (project.previewPath) {
      const preview = create("img", "komorebi-wallpaper-preview");
      preview.alt = "";
      preview.loading = "lazy";
      preview.decoding = "async";
      preview.src = toFileURI(project.previewPath);
      previewFrame.appendChild(preview);
    }
    previewFrame.appendChild(create("span", "komorebi-wallpaper-spinner"));
    selectButton.appendChild(previewFrame);

    const badges = create("span", "komorebi-card-badges");
    if (current) {
      const active = create("span", "komorebi-active-badge");
      document.l10n.setAttributes(active, "komorebi-active-wallpaper");
      badges.appendChild(active);
    }
    if (!project.supported) {
      const status = create("span", "komorebi-wallpaper-status");
      document.l10n.setAttributes(
        status,
        project.packageIssue
          ? "komorebi-scene-package-mismatch"
          : "komorebi-unsupported-wallpaper"
      );
      badges.appendChild(status);
    }
    if (project.loadError) {
      const status = create("span", "komorebi-wallpaper-status error");
      document.l10n.setAttributes(status, "komorebi-wallpaper-load-error");
      badges.appendChild(status);
    }
    selectButton.appendChild(badges);

    selectButton.title = project.title;
    const title = create("span", "komorebi-wallpaper-title");
    title.textContent = project.title;
    selectButton.appendChild(title);

    if (project.filePath) {
      selectButton.addEventListener("click", () =>
        onCardSelect(card, project)
      );
    }

    const favoriteButton = create("button", "komorebi-favorite-button");
    favoriteButton.type = "button";
    favoriteButton.classList.toggle(
      "selected",
      favorites.has(project.directory)
    );
    document.l10n.setAttributes(
      favoriteButton,
      favorites.has(project.directory)
        ? "komorebi-remove-favorite"
        : "komorebi-add-favorite"
    );
    favoriteButton.addEventListener("click", () => {
      if (favorites.has(project.directory)) {
        favorites.delete(project.directory);
      } else {
        favorites.add(project.directory);
      }
      saveFavorites();
      renderProjects();
    });

    card.append(selectButton, favoriteButton);
    if (global.KomorebiMedia.isMediaDirectory(project.directory)) {
      const deleteButton = create("button", "komorebi-delete-button");
      deleteButton.type = "button";
      document.l10n.setAttributes(deleteButton, "komorebi-delete-media-button");
      deleteButton.addEventListener("click", () => deleteAddedProject(project));
      card.appendChild(deleteButton);
    }

    return card;
  }

  function isSteamProject(project) {
    const directory = normalizeSourcePath(project.directory);
    return steamSources.some(source => {
      const key = normalizeSourcePath(source);
      return (
        librarySources.some(item => normalizeSourcePath(item) === key) &&
        directory.startsWith(`${key}\\`)
      );
    });
  }

  function setPreview(image, project) {
    image.hidden = !project?.previewPath;
    if (project?.previewPath) {
      image.src = toFileURI(project.previewPath);
    }
  }

  function setDetailOpen(open) {
    detailOpen = open && Boolean(currentProject);
    renderCurrent();
  }

  function renderCurrent() {
    welcome.hidden = hasWallpaper || Boolean(currentFilePath);
    nowBlock.hidden = !currentProject;
    if (!currentProject) {
      detailOpen = false;
    }
    detail.hidden = !detailOpen;
    if (currentProject) {
      nowTitle.textContent = currentProject.title;
      setPreview(nowPreview, currentProject);
      detailTitle.textContent = currentProject.title;
      setPreview(detailPreview, currentProject);
      document.l10n.setAttributes(
        detailType,
        {
          image: "komorebi-type-image",
          scene: "komorebi-type-scene",
        }[currentProject.type] ?? "komorebi-type-video"
      );
    }
    const count = projects.filter(
      project => project.supported && isSteamProject(project)
    ).length;
    welcomeSteam.hidden = !count;
    if (count) {
      document.l10n.setAttributes(welcomeSteam, "komorebi-welcome-steam", {
        count,
      });
    }
  }

  function sortProjects(list) {
    const byName = (a, b) => a.title.localeCompare(b.title);
    const byRecent = (a, b) => b.addedAt - a.addedAt || byName(a, b);
    const compare = {
      oldest: (a, b) => a.addedAt - b.addedAt || byName(a, b),
      name: byName,
      favorites: (a, b) =>
        favorites.has(b.directory) - favorites.has(a.directory) ||
        byRecent(a, b),
    }[sortSelect.value];
    list.sort(compare ?? byRecent);
  }

  function renderProjects() {
    if (!dialog.open) {
      return;
    }
    const query = searchInput.value.trim().toLocaleLowerCase();
    const type = typeValue;
    const tag = tagFilter.value;
    const visibleProjects = projects.filter(project => {
      return (
        (unsupportedFilter.checked || project.supported) &&
        (type === "all" || project.type === type) &&
        (!query || project.title.toLocaleLowerCase().includes(query)) &&
        (!tag || project.tags.includes(tag)) &&
        (!favoritesFilter.checked || favorites.has(project.directory))
      );
    });
    sortProjects(visibleProjects);
    const fragment = document.createDocumentFragment();
    for (const project of visibleProjects) {
      fragment.appendChild(createCard(project));
    }
    grid.replaceChildren(fragment);
    grid.toggleAttribute("aria-busy", scanning);
    const noProjects = !projects.length;
    emptyState.hidden = Boolean(visibleProjects.length) || (scanning && noProjects);
    emptyAddButton.hidden = !noProjects;
    document.l10n.setAttributes(
      emptyText,
      noProjects ? "komorebi-library-empty" : "komorebi-library-no-match"
    );
    renderCurrent();
  }

  function updateTagFilter() {
    const currentTag = tagFilter.value;
    const tags = [...new Set(projects.flatMap(project => project.tags))].sort();
    const fragment = document.createDocumentFragment();
    const allTags = document.createElement("option");
    allTags.value = "";
    document.l10n.setAttributes(allTags, "komorebi-all-tags");
    fragment.appendChild(allTags);
    for (const tag of tags) {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = tag;
      fragment.appendChild(option);
    }
    tagFilter.replaceChildren(fragment);
    tagFilter.value = tags.includes(currentTag) ? currentTag : "";
  }

  function renderAll() {
    updateTagFilter();
    renderProjects();
    renderFolders();
  }

  async function refresh() {
    const token = ++scanToken;
    scanning = true;
    if (dialog) {
      renderProjects();
    }
    try {
      await scanProjects();
    } finally {
      if (token === scanToken) {
        scanning = false;
      }
    }
    if (token === scanToken && dialog) {
      renderAll();
    }
  }

  function openProjectContextMenu(project, event) {
    const menu = document.getElementById("komorebi-project-context-menu");
    menu.komorebiProject = project;
    document.l10n.setAttributes(
      menu.querySelector(".komorebi-remove-item"),
      global.KomorebiMedia.isMediaDirectory(project.directory)
        ? "komorebi-delete-media"
        : "komorebi-hide-wallpaper"
    );
    menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
  }

  function createProjectContextMenu() {
    const menu = document.createXULElement("menupopup");
    menu.id = "komorebi-project-context-menu";

    const revealItem = document.createXULElement("menuitem");
    document.l10n.setAttributes(revealItem, "komorebi-reveal-wallpaper");
    revealItem.addEventListener("command", () => {
      const directory = Cc["@mozilla.org/file/local;1"].createInstance(
        Ci.nsIFile
      );
      directory.initWithPath(menu.komorebiProject.directory);
      directory.reveal();
    });

    const removeItem = document.createXULElement("menuitem");
    removeItem.className = "komorebi-remove-item";
    document.l10n.setAttributes(removeItem, "komorebi-hide-wallpaper");
    removeItem.addEventListener("command", () => {
      const project = menu.komorebiProject;
      if (global.KomorebiMedia.isMediaDirectory(project.directory)) {
        deleteAddedProject(project);
        return;
      }
      hiddenProjects.add(project.directory);
      favorites.delete(project.directory);
      saveHiddenProjects();
      saveFavorites();
      refresh();
    });

    menu.append(revealItem, removeItem);
    document.getElementById("mainPopupSet").appendChild(menu);
  }

  async function addLibrarySource() {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker
    );
    const title = await document.l10n.formatValue(
      "komorebi-choose-library-title"
    );
    picker.init(window.browsingContext, title, Ci.nsIFilePicker.modeGetFolder);

    const displayPath = librarySources[0];
    if (displayPath && (await IOUtils.exists(displayPath))) {
      const directory = Cc["@mozilla.org/file/local;1"].createInstance(
        Ci.nsIFile
      );
      directory.initWithPath(displayPath);
      picker.displayDirectory = directory;
    }

    const result = await new Promise(resolve => picker.open(resolve));
    if (result === Ci.nsIFilePicker.returnCancel) {
      return;
    }

    const key = normalizeSourcePath(picker.file.path);
    const dismissed = loadStringSet(DISMISSED_SOURCES_PREF);
    if (dismissed.delete(key)) {
      saveStringSet(DISMISSED_SOURCES_PREF, dismissed);
    }
    if (!librarySources.some(path => normalizeSourcePath(path) === key)) {
      librarySources.push(picker.file.path);
      saveLibrarySources();
    }
    await refresh();
  }

  function showNotices(entries) {
    window.clearTimeout(noticeTimer);
    notice.replaceChildren(
      ...entries.map(({ args, error, id }) => {
        const line = create("p", error ? "error" : "");
        document.l10n.setAttributes(line, id, args);
        return line;
      })
    );
    notice.hidden = !entries.length;
    noticeTimer = window.setTimeout(() => {
      notice.hidden = true;
    }, NOTICE_MS);
  }

  /**
   * Copies files into the library, applies the first one that was added and
   * tells the user what was added and what was refused, and why.
   */
  async function addMedia(items) {
    const outcome = await global.KomorebiMedia.addFiles(items);
    const entries = outcome.rejected.map(({ details, name, reason }) => ({
      args: { name, ...details },
      error: true,
      id: `komorebi-media-${reason}`,
    }));
    if (outcome.added.length) {
      entries.unshift({
        args: { count: outcome.added.length },
        id: "komorebi-media-added",
      });
    }
    showNotices(entries);
    if (outcome.added.length) {
      await refresh();
      const first = projects.find(
        project => project.directory === outcome.added[0].directory
      );
      if (first) {
        await applyWallpaper(first);
      }
    }
    return outcome;
  }

  async function addFiles() {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker
    );
    const [title, filter] = await Promise.all([
      document.l10n.formatValue("komorebi-choose-file-title"),
      document.l10n.formatValue("komorebi-file-filter-media"),
    ]);
    picker.init(
      window.browsingContext,
      title,
      Ci.nsIFilePicker.modeOpenMultiple
    );
    picker.appendFilter(filter, MEDIA_FILE_PATTERN);
    picker.appendFilters(Ci.nsIFilePicker.filterAll);
    const result = await new Promise(resolve => picker.open(resolve));
    if (result === Ci.nsIFilePicker.returnCancel) {
      return;
    }
    await addMedia(
      Array.from(picker.files, file => ({
        name: file.leafName,
        path: file.path,
      }))
    );
  }

  function dragHasFiles(event) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  function setDropState(dropping) {
    dropDepth = dropping ? dropDepth : 0;
    dialog.classList.toggle("dropping", dropping);
  }

  function onDrop(event) {
    event.preventDefault();
    setDropState(false);
    const items = Array.from(event.dataTransfer.files, file => ({
      file,
      name: file.name,
      path: file.mozFullPath || undefined,
    }));
    if (items.length) {
      addMedia(items).catch(error =>
        console.error("Komorebi could not add the dropped files", error)
      );
    }
  }

  function bindDropTarget(target) {
    target.addEventListener("dragenter", event => {
      if (dragHasFiles(event)) {
        event.preventDefault();
        dropDepth++;
        setDropState(true);
      }
    });
    target.addEventListener("dragover", event => {
      if (dragHasFiles(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    });
    target.addEventListener("dragleave", event => {
      if (dragHasFiles(event)) {
        dropDepth = Math.max(0, dropDepth - 1);
        setDropState(dropDepth > 0);
      }
    });
    target.addEventListener("drop", event => {
      if (dragHasFiles(event)) {
        onDrop(event);
      }
    });
  }

  async function deleteAddedProject(project) {
    if (currentProject?.directory === project.directory) {
      // Also releases the host's hold on the file.
      removeWallpaper();
    }
    favorites.delete(project.directory);
    saveFavorites();
    for (let attempt = 1; ; attempt++) {
      try {
        await global.KomorebiMedia.remove(project.directory);
        break;
      } catch (error) {
        if (attempt === DELETE_RETRIES) {
          console.error("Komorebi could not delete the added file", error);
          break;
        }
        await new Promise(resolve =>
          window.setTimeout(resolve, DELETE_RETRY_MS)
        );
      }
    }
    await refresh();
  }

  function removeLibrarySource(source) {
    const dismissed = loadStringSet(DISMISSED_SOURCES_PREF);
    dismissed.add(normalizeSourcePath(source));
    saveStringSet(DISMISSED_SOURCES_PREF, dismissed);
    librarySources = librarySources.filter(path => path !== source);
    saveLibrarySources();
    return refresh();
  }

  function renderFolders() {
    const fragment = document.createDocumentFragment();
    for (const source of librarySources) {
      const row = create("li", "komorebi-folder-row");
      const icon = create("span", "komorebi-folder-icon");
      icon.setAttribute("aria-hidden", "true");
      const path = create("span", "komorebi-folder-path");
      path.textContent = source;
      path.title = source;
      row.append(
        icon,
        path,
        createButton("quiet", "komorebi-remove-folder", () =>
          removeLibrarySource(source)
        )
      );
      fragment.appendChild(row);
    }
    foldersList.replaceChildren(fragment);
    foldersList.hidden = !librarySources.length;
    foldersEmpty.hidden = Boolean(librarySources.length);
  }

  function showPage(name) {
    activePage = name;
    for (const [key, { item, page }] of Object.entries(pages)) {
      const selected = key === name;
      item.setAttribute("aria-selected", selected);
      item.tabIndex = selected ? 0 : -1;
      page.hidden = !selected;
    }
    document.l10n.setAttributes(pageTitle, `komorebi-nav-${name}`);
    document.l10n.setAttributes(
      pageDescription,
      `komorebi-page-${name}-description`
    );
    if (name === "folders") {
      renderFolders();
    }
    syncSettings();
    if (name === "performance") {
      startUsageMonitor();
    } else {
      stopUsageMonitor();
    }
  }

  function createButton(kind, l10nId, onClick) {
    const button = create("button", `komorebi-button ${kind}`);
    button.type = "button";
    document.l10n.setAttributes(button, l10nId);
    button.addEventListener("click", onClick);
    return button;
  }

  function nextControlId() {
    controlCount++;
    return `komorebi-control-${controlCount}`;
  }

  function createSelect(id, options, value) {
    const select = document.createElement("select");
    select.id = id;
    for (const [optionValue, l10nId] of options) {
      const option = document.createElement("option");
      option.value = optionValue;
      document.l10n.setAttributes(option, l10nId);
      select.appendChild(option);
    }
    select.value = value;
    return select;
  }

  function createChoiceSelect(options, read, write, id = nextControlId()) {
    const select = createSelect(id, options, read());
    select.className = "komorebi-select";
    select.addEventListener("change", () => write(select.value));
    settingsSync.push(() => {
      select.value = read();
    });
    return select;
  }

  function createSwitch(read, write) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = nextControlId();
    input.className = "komorebi-switch";
    input.setAttribute("role", "switch");
    input.checked = read();
    input.addEventListener("change", () => write(input.checked));
    settingsSync.push(() => {
      input.checked = read();
    });
    return input;
  }

  function createPrefSwitch(pref, defaultValue) {
    return createSwitch(
      () => Services.prefs.getBoolPref(pref, defaultValue),
      value => Services.prefs.setBoolPref(pref, value)
    );
  }

  function createSegmented(options, read, write) {
    const group = create("div", "komorebi-segmented");
    group.setAttribute("role", "radiogroup");
    const buttons = new Map();
    const sync = () => {
      const value = read();
      for (const [key, button] of buttons) {
        button.setAttribute("aria-checked", key === value);
        button.tabIndex = key === value ? 0 : -1;
      }
    };
    for (const [value, l10nId] of options) {
      const button = create("button", "komorebi-segment");
      button.type = "button";
      button.setAttribute("role", "radio");
      document.l10n.setAttributes(button, l10nId);
      button.addEventListener("click", () => {
        write(value);
        sync();
      });
      buttons.set(value, button);
      group.appendChild(button);
    }
    group.addEventListener("keydown", event => {
      const step = {
        ArrowRight: 1,
        ArrowDown: 1,
        ArrowLeft: -1,
        ArrowUp: -1,
      }[event.key];
      if (!step) {
        return;
      }
      event.preventDefault();
      const keys = [...buttons.keys()];
      const next = keys[(keys.indexOf(read()) + step + keys.length) % keys.length];
      write(next);
      sync();
      buttons.get(next).focus();
    });
    settingsSync.push(sync);
    sync();
    return group;
  }

  function createSlider({ min, max, step, read, write, format }) {
    const wrapper = create("div", "komorebi-slider");
    const input = document.createElement("input");
    input.type = "range";
    input.className = "komorebi-range";
    input.id = nextControlId();
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const value = create("span", "komorebi-slider-value");
    value.setAttribute("aria-hidden", "true");
    const paint = () => {
      const ratio = (Number(input.value) - min) / (max - min);
      input.style.setProperty("--komorebi-fill", `${ratio * 100}%`);
      value.textContent = format(Number(input.value));
    };
    input.addEventListener("input", () => {
      paint();
      write(Number(input.value));
    });
    const sync = () => {
      input.value = read();
      paint();
    };
    settingsSync.push(sync);
    sync();
    wrapper.append(input, value);
    wrapper.labelTarget = input;
    return wrapper;
  }

  function createRow(titleId, descriptionId, control, { stacked = false } = {}) {
    const row = create("div", "komorebi-row");
    row.classList.toggle("stacked", stacked);
    const text = create("div", "komorebi-row-text");
    const grouped = control.getAttribute("role") === "radiogroup";
    const title = create(grouped ? "span" : "label", "komorebi-row-title");
    document.l10n.setAttributes(title, titleId);
    if (grouped) {
      title.id = nextControlId();
      control.setAttribute("aria-labelledby", title.id);
    } else {
      const target = control.labelTarget || control;
      target.id ||= nextControlId();
      title.htmlFor = target.id;
    }
    text.appendChild(title);
    row.description = null;
    if (descriptionId) {
      row.description = create("p", "komorebi-row-description");
      document.l10n.setAttributes(row.description, descriptionId);
      text.appendChild(row.description);
    }
    const holder = create("div", "komorebi-row-control");
    holder.appendChild(control);
    row.append(text, holder);
    return row;
  }

  function createPanel(...rows) {
    const panel = create("div", "komorebi-panel");
    panel.append(...rows);
    return panel;
  }

  function createGroupTitle(l10nId) {
    const heading = create("h3", "komorebi-group-title");
    document.l10n.setAttributes(heading, l10nId);
    return heading;
  }

  function createNote(l10nId) {
    const note = create("p", "komorebi-note");
    document.l10n.setAttributes(note, l10nId);
    return note;
  }

  function readChoice(pref, allowed, fallback) {
    const value = Services.prefs.getStringPref(pref, fallback);
    return allowed.includes(value) ? value : fallback;
  }

  function createUsageStat(labelId) {
    const stat = create("div", "komorebi-stat");
    const label = create("span", "komorebi-stat-label");
    document.l10n.setAttributes(label, labelId);
    const value = create("strong", "komorebi-stat-value");
    document.l10n.setAttributes(value, "komorebi-usage-pending");
    stat.append(label, value);
    return { stat, value };
  }

  function setUsageValue(element, id, value) {
    document.l10n.setAttributes(element, id, { value });
  }

  async function sampleUsage() {
    if (usageBusy) {
      return;
    }
    usageBusy = true;
    try {
      const info = await ChromeUtils.requestProcInfo();
      if (!usageTimer) {
        return;
      }
      const processes = [
        info,
        ...info.children.filter(child => child.type === "gpu"),
      ];
      const now = performance.now();
      const cpuTime = processes.reduce((sum, item) => sum + item.cpuTime, 0);
      const memory = processes.reduce((sum, item) => sum + item.memory, 0);
      setUsageValue(
        usageValues.fps,
        "komorebi-usage-fps-value",
        Math.max(renderers.scene.fps, renderers.video.fps)
      );
      setUsageValue(
        usageValues.memory,
        "komorebi-usage-memory-value",
        memory / (1024 * 1024)
      );
      if (usageSample) {
        const elapsedNs = (now - usageSample.time) * 1e6;
        const cores = navigator.hardwareConcurrency || 1;
        const percent = Math.max(
          0,
          ((cpuTime - usageSample.cpuTime) / elapsedNs / cores) * 100
        );
        setUsageValue(usageValues.cpu, "komorebi-usage-cpu-value", percent);
      }
      usageSample = { cpuTime, time: now };
    } catch (error) {
      console.error("Komorebi could not read the process usage", error);
    } finally {
      usageBusy = false;
    }
  }

  function startUsageMonitor() {
    if (usageTimer || !dialog?.open) {
      return;
    }
    usageSample = null;
    usageTimer = window.setInterval(sampleUsage, USAGE_INTERVAL_MS);
    sampleUsage();
  }

  function stopUsageMonitor() {
    if (usageTimer) {
      window.clearInterval(usageTimer);
    }
    usageTimer = null;
    usageSample = null;
  }

  function syncSettings() {
    for (const sync of settingsSync) {
      sync();
    }
  }

  function updateRendererSettings() {
    const settings = getVideoSettings();
    renderers.scene.updateSettings(settings);
    renderers.video.updateSettings(settings);
    renderers.image.updateSettings(settings);
    const root = document.documentElement;
    root.toggleAttribute("komorebi-mirror", settings.mirror);
    if (settings.filter === "none") {
      root.removeAttribute("komorebi-filter");
    } else {
      root.setAttribute("komorebi-filter", settings.filter);
    }
  }

  async function resetAllSettings() {
    const [title, text] = await Promise.all([
      document.l10n.formatValue("komorebi-reset-confirm-title"),
      document.l10n.formatValue("komorebi-reset-confirm-text"),
    ]);
    if (!Services.prompt.confirm(window, title, text)) {
      return;
    }
    for (const pref of RESET_PREFS) {
      Services.prefs.clearUserPref(pref);
    }
    syncSettings();
  }

  function createFitControl() {
    return createSegmented(
      [
        ["cover", "komorebi-fit-cover"],
        ["contain", "komorebi-fit-contain"],
        ["stretch", "komorebi-fit-stretch"],
      ],
      () => getVideoSettings().fit,
      value => Services.prefs.setStringPref(`${VIDEO_PREF}fit`, value)
    );
  }

  function createSpeedControl() {
    return createSlider({
      min: MIN_SPEED,
      max: MAX_SPEED,
      step: 0.05,
      read: () => getVideoSettings().speed,
      write: value =>
        Services.prefs.setStringPref(
          `${VIDEO_PREF}speed`,
          String(Number(value.toFixed(2)))
        ),
      format: value => `${Number(value.toFixed(2))}×`,
    });
  }

  function createWallpaperRows(stacked) {
    const options = { stacked };
    return [
      createRow(
        "komorebi-set-fit",
        "komorebi-set-fit-description",
        createFitControl(),
        options
      ),
      createRow(
        "komorebi-set-speed",
        "komorebi-set-speed-description",
        createSpeedControl(),
        options
      ),
      createRow(
        "komorebi-set-mirror",
        "komorebi-set-mirror-description",
        createPrefSwitch(`${VIDEO_PREF}mirror`, false)
      ),
      createRow(
        "komorebi-set-filter",
        null,
        createChoiceSelect(
          FILTER_OPTIONS,
          () => getVideoSettings().filter,
          value => Services.prefs.setStringPref(`${VIDEO_PREF}filter`, value)
        )
      ),
    ];
  }

  function createPage(name, ...children) {
    const page = create("section", "komorebi-page");
    page.id = `komorebi-panel-${name}`;
    page.dataset.page = name;
    page.setAttribute("role", "tabpanel");
    page.setAttribute("aria-labelledby", `komorebi-tab-${name}`);
    page.hidden = true;
    page.append(...children);
    pages[name].page = page;
    return page;
  }

  function createWallpapersPage() {
    welcome = create("div", "komorebi-welcome");
    const welcomeTitle = create("strong", "komorebi-welcome-title");
    document.l10n.setAttributes(welcomeTitle, "komorebi-welcome-title");
    welcomeSteam = create("span", "komorebi-welcome-steam");
    welcomeSteam.hidden = true;
    welcome.append(welcomeTitle, welcomeSteam);

    const toolbar = create("div", "komorebi-toolbar");
    const searchField = create("div", "komorebi-search-field");
    searchInput = document.createElement("input");
    searchInput.type = "search";
    document.l10n.setAttributes(searchInput, "komorebi-search-wallpapers");
    searchInput.addEventListener("input", renderProjects);
    searchField.appendChild(searchInput);

    const typeSegmented = createSegmented(
      [
        ["all", "komorebi-all-types"],
        ["video", "komorebi-video-type"],
        ["scene", "komorebi-scene-type"],
        ["image", "komorebi-image-type"],
      ],
      () => typeValue,
      value => {
        typeValue = value;
        renderProjects();
      }
    );
    document.l10n.setAttributes(typeSegmented, "komorebi-type-filter-label");

    tagFilter = document.createElement("select");
    tagFilter.id = "komorebi-tag-filter";
    tagFilter.className = "komorebi-select";
    document.l10n.setAttributes(tagFilter, "komorebi-tag-filter");
    tagFilter.addEventListener("change", renderProjects);

    sortSelect = createChoiceSelect(
      SORT_OPTIONS,
      () => readChoice(SORT_PREF, SORT_OPTIONS.map(([value]) => value), "recent"),
      value => {
        Services.prefs.setStringPref(SORT_PREF, value);
        renderProjects();
      },
      "komorebi-sort-select"
    );
    document.l10n.setAttributes(sortSelect, "komorebi-sort-label");

    const createChip = (l10nId, kind) => {
      const label = create("label", `komorebi-chip ${kind}`);
      const input = document.createElement("input");
      input.type = "checkbox";
      input.addEventListener("change", renderProjects);
      const text = document.createElement("span");
      document.l10n.setAttributes(text, l10nId);
      label.append(input, text);
      return { label, input };
    };
    const favoritesChip = createChip("komorebi-favorites-only", "favorites");
    favoritesFilter = favoritesChip.input;
    const unsupportedChip = createChip(
      "komorebi-show-unsupported",
      "unsupported"
    );
    unsupportedFilter = unsupportedChip.input;
    toolbar.append(
      searchField,
      typeSegmented,
      tagFilter,
      sortSelect,
      favoritesChip.label,
      unsupportedChip.label,
      createButton("default", "komorebi-add-file", addFiles)
    );

    grid = create("div", "komorebi-wallpaper-grid");

    emptyState = create("div", "komorebi-empty-state");
    emptyText = document.createElement("p");
    emptyAddButton = createButton(
      "primary",
      "komorebi-add-folder",
      addLibrarySource
    );
    emptyState.append(
      emptyText,
      createButton("default", "komorebi-add-file", addFiles),
      emptyAddButton
    );

    const scroller = create("div", "komorebi-wallpaper-scroll");
    scroller.append(welcome, grid, emptyState);
    const main = create("div", "komorebi-wallpapers-main");
    main.append(toolbar, scroller);

    detail = create("aside", "komorebi-detail");
    detail.hidden = true;
    const detailClose = create("button", "komorebi-icon-button");
    detailClose.type = "button";
    detailClose.dataset.icon = "close";
    document.l10n.setAttributes(detailClose, "komorebi-close-details");
    detailClose.addEventListener("click", () => setDetailOpen(false));
    const detailFrame = create("div", "komorebi-detail-preview-frame");
    detailPreview = create("img", "komorebi-detail-preview");
    detailPreview.alt = "";
    detailFrame.append(detailPreview, detailClose);
    detailTitle = create("h3", "komorebi-detail-title");
    detailType = create("span", "komorebi-type-chip");
    const detailHead = create("div", "komorebi-detail-head");
    detailHead.append(detailTitle, detailType);
    detail.append(
      detailFrame,
      detailHead,
      createPanel(...createWallpaperRows(true))
    );

    return createPage("wallpapers", main, detail);
  }

  function createFoldersPage() {
    const actions = create("div", "komorebi-actions");
    actions.append(
      createButton("primary", "komorebi-add-folder", addLibrarySource),
      createButton("default", "komorebi-add-file", addFiles)
    );
    foldersList = create("ul", "komorebi-folders-list komorebi-panel");
    foldersEmpty = createNote("komorebi-folders-empty");
    return createPage("folders", actions, foldersList, foldersEmpty);
  }

  function createPerformancePage() {
    const stats = create("div", "komorebi-stats");
    const fps = createUsageStat("komorebi-usage-fps");
    const cpu = createUsageStat("komorebi-usage-cpu");
    const memory = createUsageStat("komorebi-usage-memory");
    usageValues = { fps: fps.value, cpu: cpu.value, memory: memory.value };
    stats.append(fps.stat, cpu.stat, memory.stat);

    const mode = createRow(
      "komorebi-set-power",
      `komorebi-power-${getPowerMode()}-description`,
      createSegmented(
        POWER_MODE_ORDER.map(name => [name, `komorebi-power-${name}`]),
        getPowerMode,
        value => Services.prefs.setStringPref(POWER_MODE_PREF, value)
      )
    );
    const fpsRow = createRow(
      "komorebi-set-fps",
      "komorebi-set-fps-description",
      createSlider({
        min: MIN_CUSTOM_FPS,
        max: MAX_CUSTOM_FPS,
        step: 1,
        read: () => getVideoSettings().customFPS,
        write: value => Services.prefs.setIntPref(CUSTOM_FPS_PREF, value),
        format: String,
      })
    );
    settingsSync.push(() => {
      document.l10n.setAttributes(
        mode.description,
        `komorebi-power-${getPowerMode()}-description`
      );
      fpsRow.hidden = getPowerMode() !== "custom";
    });

    return createPage(
      "performance",
      stats,
      createNote("komorebi-usage-note"),
      createPanel(mode, fpsRow),
      createPanel(
        createRow(
          "komorebi-set-effects",
          "komorebi-set-effects-description",
          createPrefSwitch(EFFECTS_PREF, true)
        ),
        createRow(
          "komorebi-set-resolution",
          "komorebi-set-resolution-description",
          createChoiceSelect(
            RESOLUTION_OPTIONS,
            () => String(getVideoSettings().renderScale),
            value => Services.prefs.setStringPref(RENDER_SCALE_PREF, value)
          )
        ),
        createRow(
          "komorebi-set-freeze",
          "komorebi-set-freeze-description",
          createPrefSwitch(PAUSE_BACKGROUND_PREF, false)
        )
      )
    );
  }

  function createSoundPage() {
    return createPage(
      "sound",
      createPanel(
        createRow(
          "komorebi-set-mute",
          null,
          createSwitch(
            () => getVideoSettings().muted,
            value => Services.prefs.setBoolPref(`${VIDEO_PREF}muted`, value)
          )
        ),
        createRow(
          "komorebi-set-volume",
          null,
          createSlider({
            min: 0,
            max: 1,
            step: 0.05,
            read: () => getVideoSettings().volume,
            write: value => {
              Services.prefs.setCharPref(
                `${VIDEO_PREF}volume`,
                String(Number(value.toFixed(2)))
              );
              if (value > 0 && getVideoSettings().muted) {
                Services.prefs.setBoolPref(`${VIDEO_PREF}muted`, false);
              }
            },
            format: value => `${Math.round(value * 100)}%`,
          })
        )
      ),
      createPanel(
        createRow(
          "komorebi-set-music-scope",
          "komorebi-set-music-scope-description",
          createChoiceSelect(
            MUSIC_SCOPE_OPTIONS,
            () => readChoice(MUSIC_SCOPE_PREF, MUSIC_SCOPES, "newtab"),
            value => Services.prefs.setStringPref(MUSIC_SCOPE_PREF, value)
          )
        ),
        createRow(
          "komorebi-set-music-background",
          null,
          createPrefSwitch(MUSIC_BACKGROUND_PREF, true)
        ),
        createRow(
          "komorebi-set-tab-audio",
          "komorebi-set-tab-audio-description",
          createPrefSwitch(TAB_AUDIO_PREF, true)
        )
      )
    );
  }

  function createAppearancePage() {
    return createPage(
      "appearance",
      createPanel(
        createRow(
          "komorebi-set-match-theme",
          "komorebi-set-match-theme-description",
          createPrefSwitch(MATCH_THEME_PREF, true)
        ),
        createRow(
          "komorebi-set-search-wallpaper",
          "komorebi-set-search-wallpaper-description",
          createSegmented(
            SEARCH_MODE_OPTIONS,
            () => readChoice(SEARCH_WALLPAPER_PREF, SEARCH_MODES, "full"),
            value => Services.prefs.setStringPref(SEARCH_WALLPAPER_PREF, value)
          )
        ),
        createRow(
          "komorebi-set-search-opacity",
          "komorebi-set-search-opacity-description",
          createSlider({
            min: 30,
            max: 100,
            step: 5,
            read: () => Services.prefs.getIntPref(SEARCH_OPACITY_PREF, 70),
            write: value => Services.prefs.setIntPref(SEARCH_OPACITY_PREF, value),
            format: value => `${value}%`,
          })
        ),
        createRow(
          "komorebi-set-show-search",
          null,
          createPrefSwitch(`${NEWTAB_PREF}showSearch`, true)
        ),
        createRow(
          "komorebi-set-compact",
          "komorebi-set-compact-description",
          createPrefSwitch(COMPACT_PREF, false)
        )
      ),
      createGroupTitle("komorebi-group-current"),
      createPanel(
        ...createWallpaperRows(false),
        createRow(
          "komorebi-set-pause",
          null,
          createPrefSwitch(`${VIDEO_PREF}paused`, false)
        )
      )
    );
  }

  function updateStatusMessage(state, update) {
    const version = update.version;
    switch (state.phase) {
      case "checking":
        return ["komorebi-update-status-checking"];
      case "available":
        return [
          "komorebi-update-status-available",
          { latest: state.latest.version, version },
        ];
      case "downloading":
        return [
          "komorebi-update-status-downloading",
          { percent: Math.round(state.progress * 100) },
        ];
      case "verifying":
        return ["komorebi-update-status-verifying"];
      case "installing":
        return ["komorebi-update-status-installing"];
      case "error":
        return [`komorebi-update-error-${state.error}`, { version }];
      default:
        return update.updatesEnabled()
          ? ["komorebi-update-status-current", { version }]
          : ["komorebi-update-status-dev", { version }];
    }
  }

  function createUpdateRow() {
    const update = global.KomorebiUpdate;
    const control = create("div", "komorebi-update-control");
    const progress = document.createElement("progress");
    progress.max = 1;
    progress.hidden = true;
    const checkButton = createButton("default", "komorebi-update-check", () =>
      update.check()
    );
    // Labelled once a release is known: its text needs the version.
    const installButton = create("button", "komorebi-button primary");
    installButton.type = "button";
    installButton.addEventListener("click", () => update.install());
    installButton.hidden = true;
    control.append(progress, checkButton, installButton);
    const row = createRow("komorebi-update-title", null, control);
    row.description = create("p", "komorebi-row-description");
    row.querySelector(".komorebi-row-text").appendChild(row.description);

    const render = () => {
      const state = update.getState();
      const [id, args] = updateStatusMessage(state, update);
      document.l10n.setAttributes(row.description, id, args);
      const working = ["checking", "downloading", "verifying", "installing"];
      const busy = working.includes(state.phase);
      progress.hidden = state.phase !== "downloading";
      progress.value = state.progress;
      checkButton.disabled = busy || !update.updatesEnabled();
      installButton.hidden = !(
        state.phase === "available" || state.phase === "error"
      ) || !state.latest;
      installButton.disabled = busy || !update.updatesEnabled();
      if (state.latest) {
        document.l10n.setAttributes(installButton, "komorebi-update-install", {
          latest: state.latest.version,
        });
      }
    };
    update.onChange(render);
    settingsSync.push(render);
    render();
    return row;
  }

  function createBrowserPage() {
    const sleep = createChoiceSelect(
      SLEEP_OPTIONS,
      () => String(Services.prefs.getIntPref(SLEEP_PREF, 30)),
      value => Services.prefs.setIntPref(SLEEP_PREF, Number(value)),
      "komorebi-sleep"
    );
    const setup = createButton("default", "komorebi-run-setup", () => {
      dialog.close();
      window.KomorebiOnboarding?.open();
    });
    const reset = createButton("danger", "komorebi-reset-all", resetAllSettings);
    return createPage(
      "browser",
      createPanel(
        createUpdateRow(),
        createRow(
          "komorebi-update-auto",
          "komorebi-update-auto-description",
          createPrefSwitch("browser.komorebi.update.autoCheck", true)
        )
      ),
      createPanel(createRow("komorebi-sleep-label", null, sleep)),
      createNote("komorebi-features-shortcuts"),
      createPanel(
        createRow("komorebi-set-setup", "komorebi-set-setup-description", setup),
        createRow("komorebi-set-reset", "komorebi-set-reset-description", reset)
      )
    );
  }

  function createRail() {
    const rail = create("aside", "komorebi-rail");

    const brand = create("div", "komorebi-brand");
    const logo = document.createElement("img");
    logo.src = "chrome://branding/content/about-logo.svg";
    logo.alt = "";
    const name = document.createElement("h2");
    document.l10n.setAttributes(name, "komorebi-library-title");
    brand.append(logo, name);

    const nav = create("nav", "komorebi-nav");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-orientation", "vertical");
    document.l10n.setAttributes(nav, "komorebi-nav-label");
    for (const pageName of PAGES) {
      const item = create("button", "komorebi-nav-item");
      item.type = "button";
      item.id = `komorebi-tab-${pageName}`;
      item.dataset.page = pageName;
      item.setAttribute("role", "tab");
      item.setAttribute("aria-controls", `komorebi-panel-${pageName}`);
      const icon = create("span", "komorebi-nav-icon");
      icon.setAttribute("aria-hidden", "true");
      const label = create("span", "komorebi-nav-text");
      document.l10n.setAttributes(label, `komorebi-nav-${pageName}`);
      item.append(icon, label);
      item.addEventListener("click", () => showPage(pageName));
      pages[pageName] = { item };
      nav.appendChild(item);
    }
    nav.addEventListener("keydown", event => {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      let index = PAGES.indexOf(activePage);
      if (step) {
        index = (index + step + PAGES.length) % PAGES.length;
      } else if (event.key === "Home") {
        index = 0;
      } else if (event.key === "End") {
        index = PAGES.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      showPage(PAGES[index]);
      pages[PAGES[index]].item.focus();
    });

    nowBlock = create("div", "komorebi-now");
    nowBlock.hidden = true;
    const nowOpen = create("button", "komorebi-now-open");
    nowOpen.type = "button";
    nowPreview = create("img", "komorebi-now-preview");
    nowPreview.alt = "";
    const nowText = create("span", "komorebi-now-text");
    const nowLabel = create("span", "komorebi-now-label");
    document.l10n.setAttributes(nowLabel, "komorebi-current-label");
    nowTitle = create("strong", "komorebi-now-title");
    nowText.append(nowLabel, nowTitle);
    nowOpen.append(nowPreview, nowText);
    nowOpen.addEventListener("click", () => {
      showPage("wallpapers");
      setDetailOpen(true);
    });
    nowBlock.append(
      nowOpen,
      createButton("quiet", "komorebi-remove-wallpaper", removeWallpaper)
    );

    rail.append(brand, nav, nowBlock);
    return rail;
  }

  function createMain() {
    const main = create("main", "komorebi-main");

    const closeButton = create("button", "komorebi-icon-button komorebi-close");
    closeButton.type = "button";
    closeButton.dataset.icon = "close";
    document.l10n.setAttributes(closeButton, "komorebi-close-library");
    closeButton.addEventListener("click", () => dialog.close());

    const head = create("header", "komorebi-page-head");
    pageTitle = document.createElement("h2");
    pageDescription = document.createElement("p");
    head.append(pageTitle, pageDescription);

    const container = create("div", "komorebi-pages");
    container.append(
      createWallpapersPage(),
      createFoldersPage(),
      createPerformancePage(),
      createSoundPage(),
      createAppearancePage(),
      createBrowserPage()
    );
    notice = create("div", "komorebi-notice");
    notice.hidden = true;
    notice.setAttribute("role", "status");
    main.append(head, notice, container, closeButton);
    return main;
  }

  function createDialog() {
    dialog = document.createElement("dialog");
    dialog.id = "komorebi-library-dialog";
    document.l10n.setAttributes(dialog, "komorebi-library-dialog");
    dialog.addEventListener("close", stopUsageMonitor);
    dialog.addEventListener("close", () => grid.replaceChildren());
    dialog.addEventListener("click", event => {
      if (event.target === dialog) {
        dialog.close();
      }
    });

    pages = {};
    settingsSync = [];
    const shell = create("div", "komorebi-shell");
    shell.append(createRail(), createMain());
    const overlay = create("div", "komorebi-drop-overlay");
    const overlayTitle = create("strong", "komorebi-drop-title");
    document.l10n.setAttributes(overlayTitle, "komorebi-drop-title");
    const overlayText = create("span", "komorebi-drop-text");
    document.l10n.setAttributes(overlayText, "komorebi-drop-text");
    overlay.append(overlayTitle, overlayText);
    shell.appendChild(overlay);
    dialog.appendChild(shell);
    bindDropTarget(dialog);
    dialog.addEventListener("close", () => setDropState(false));
    document.body.appendChild(dialog);
    showPage("wallpapers");
  }

  function ensureDialog() {
    if (!dialog) {
      createProjectContextMenu();
      createDialog();
    }
  }

  function createAppMenuButton() {
    const viewCache = document.getElementById("appMenu-viewCache");
    const mainView =
      document.getElementById("appMenu-mainView") ||
      viewCache.content.querySelector("#appMenu-mainView");
    const menuBody = mainView.querySelector(".panel-subview-body");
    const addonsButton = mainView.querySelector(
      "#appMenu-extensions-themes-button"
    );

    const button = document.createXULElement("toolbarbutton");
    button.id = "appMenu-komorebi-button";
    button.className = "subviewbutton";
    document.l10n.setAttributes(button, "komorebi-appmenu-button");
    button.addEventListener("command", () => {
      global.PanelUI.hide();
      window.setTimeout(() => {
        open();
      });
    });
    menuBody.insertBefore(button, addonsButton.nextSibling);
  }

  function registerToolbarButton() {
    try {
      if (CustomizableUI.getWidget(WIDGET_ID)?.provider === CustomizableUI.PROVIDER_API) {
        return;
      }
      CustomizableUI.createWidget({
        id: WIDGET_ID,
        type: "button",
        l10nId: "komorebi-toolbar-button",
        defaultArea: CustomizableUI.AREA_NAVBAR,
        onCommand(event) {
          event.target.ownerDocument.defaultView.KomorebiLibrary?.open();
        },
      });
    } catch (error) {
      console.error("Komorebi could not register the toolbar button", error);
    }
  }

  async function init(initConfig) {
    config = initConfig;
    renderers = config.renderers;
    favorites = loadStringSet(FAVORITES_PREF);
    hiddenProjects = loadStringSet(HIDDEN_PROJECTS_PREF);
    global.MozXULElement.insertFTLIfNeeded("browser/komorebi.ftl");

    const defaultPath = PathUtils.join(
      PathUtils.profileDir,
      "komorebi",
      "wallpapers"
    );
    librarySources = loadLibrarySources(defaultPath);
    saveLibrarySources();
    IOUtils.makeDirectory(defaultPath, { createAncestors: true }).catch(
      error => console.error("Komorebi could not create the library", error)
    );
    IOUtils.makeDirectory(global.KomorebiMedia.root(), {
      createAncestors: true,
    }).catch(error =>
      console.error("Komorebi could not create the media folder", error)
    );

    updateRendererSettings();
    createAppMenuButton();
    registerToolbarButton();

    const prefObserver = {
      observe(subject, topic, name) {
        if (name.startsWith(VIDEO_PREF) || RENDERER_PREFS.has(name)) {
          updateRendererSettings();
        }
        if (name === MATCH_THEME_PREF) {
          applyTheme(currentProject);
        }
        if (name === ACTIVE_PROJECT_PREF) {
          syncActiveProject();
        }
        if (dialog) {
          syncSettings();
        }
      },
    };
    Services.prefs.addObserver(KOMOREBI_BRANCH, prefObserver);
    window.addEventListener(
      "unload",
      () => {
        stopUsageMonitor();
        Services.prefs.removeObserver(KOMOREBI_BRANCH, prefObserver);
      },
      { once: true }
    );

    steamReady = mergeSteamSources().catch(error =>
      console.error("Komorebi could not detect Steam", error)
    );

    const stored = loadActiveProject();
    if (stored) {
      applyProject(stored, { persist: false }).catch(error =>
        console.error("Komorebi could not restore the wallpaper", error)
      );
      return;
    }
    const legacyPath = Services.prefs.getStringPref(ACTIVE_PREF, "");
    if (legacyPath) {
      restoreFromLegacyPref(legacyPath).catch(error =>
        console.error("Komorebi could not restore the wallpaper", error)
      );
    }
  }

  function open(page) {
    // A new dialog starts on the wallpapers page, so read the target first.
    const target = PAGES.includes(page) ? page : activePage;
    ensureDialog();
    if (!dialog.open) {
      dialog.showModal();
    }
    showPage(target);
    renderAll();
    refresh();
  }

  function getWallpapers() {
    return projects.filter(project => project.supported && project.filePath);
  }

  async function listWallpapers() {
    await refresh();
    return getWallpapers();
  }

  async function applyWallpaper(project) {
    if (applyingPath === project.filePath) {
      return false;
    }
    applyingPath = project.filePath;
    try {
      return await applyProject(project, { persist: true });
    } catch (error) {
      console.error("Komorebi could not apply the wallpaper", error);
      return false;
    } finally {
      if (applyingPath === project.filePath) {
        applyingPath = null;
      }
      if (dialog) {
        renderProjects();
      }
    }
  }

  global.KomorebiLibrary = {
    init,
    open,
    listWallpapers,
    getWallpapers,
    applyWallpaper,
    addFolder: addLibrarySource,
    addFiles,
    addMedia,
    getCurrentFilePath: () => currentFilePath,
    toPreviewURI: toFileURI,
  };
})(this);
