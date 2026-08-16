(function (global) {
  "use strict";

  const LEGACY_LIBRARY_PREF = "browser.komorebi.libraryPath";
  const LIBRARY_SOURCES_PREF = "browser.komorebi.librarySources";
  const ACTIVE_PREF = "browser.komorebi.activeWallpaper";
  const ACTIVE_TYPE_PREF = "browser.komorebi.activeWallpaperType";
  const FAVORITES_PREF = "browser.komorebi.favorites";
  const HIDDEN_PROJECTS_PREF = "browser.komorebi.hiddenProjects";
  const VIDEO_PREF = "browser.komorebi.video.";
  const SUPPORTED_VIDEO_TYPES = new Set(["mp4", "webm", "ogg", "ogv"]);
  const FIT_MODES = new Set(["contain", "cover", "stretch"]);
  const FPS_LIMITS = new Set([15, 30, 60]);

  let renderers;
  let dialog;
  let grid;
  let emptyState;
  let librarySources;
  let projects = [];
  let favorites;
  let hiddenProjects;
  let searchInput;
  let typeFilter;
  let tagFilter;
  let favoritesFilter;
  let libraryView;
  let foldersView;
  let settingsView;
  let foldersList;
  let selectedProject;
  let useButton;
  let applyingPath;

  function getVideoSettings() {
    const fit = Services.prefs.getStringPref(`${VIDEO_PREF}fit`, "cover");
    const maxFPS = Services.prefs.getIntPref(`${VIDEO_PREF}maxFPS`, 30);
    const volume = Services.prefs.getFloatPref(`${VIDEO_PREF}volume`, 0.5);
    return {
      fit: FIT_MODES.has(fit) ? fit : "cover",
      maxFPS: FPS_LIMITS.has(maxFPS) ? maxFPS : 30,
      muted: Services.prefs.getBoolPref(`${VIDEO_PREF}muted`, false),
      paused: Services.prefs.getBoolPref(`${VIDEO_PREF}paused`, false),
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

  function saveFavorites() {
    Services.prefs.setStringPref(
      FAVORITES_PREF,
      JSON.stringify([...favorites])
    );
  }

  function saveHiddenProjects() {
    Services.prefs.setStringPref(
      HIDDEN_PROJECTS_PREF,
      JSON.stringify([...hiddenProjects])
    );
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
      // `=== "video"`, so a capitalized type silently fell through to the
      // video-fallback path with the scene's own "scene.json" as if it
      // were a video file ("Video request failed (.../scene.json)").
      project.type = (project.type || "").toLowerCase();
      const extension = (project.file || "")
        .split(/[\\/]/)
        .pop()
        .split(".")
        .pop()
        .toLowerCase();
      const videoSupported =
        project.type === "video" && SUPPORTED_VIDEO_TYPES.has(extension);
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
        previewPath,
        sceneFile,
        supported: sceneSupported || (videoSupported && Boolean(filePath)),
        tags: Array.isArray(project.tags) ? project.tags : [],
        title: project.title || PathUtils.filename(directory),
        type: project.type || "unknown",
      };
    } catch (error) {
      console.error(`Komorebi could not read ${projectPath}`, error);
      return null;
    }
  }

  async function scanLibrary(path) {
    try {
      const rootProject = await readProject(path);
      if (rootProject) {
        return [rootProject];
      }

      const foundProjects = [];
      for (const child of await IOUtils.getChildren(path, {
        ignoreAbsent: true,
      })) {
        const info = await IOUtils.stat(child);
        if (info.type !== "directory") {
          continue;
        }
        const project = await readProject(child);
        if (project) {
          foundProjects.push(project);
        }
      }
      return foundProjects;
    } catch (error) {
      console.error(`Komorebi could not scan ${path}`, error);
      return [];
    }
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

  function selectProject(project) {
    selectedProject = project;
    useButton.disabled = !project;
    for (const card of grid.children) {
      card.classList.toggle(
        "selected",
        card.komorebiProject === selectedProject
      );
      card
        .querySelector(".komorebi-wallpaper-select")
        .setAttribute("aria-pressed", card.komorebiProject === selectedProject);
    }
  }

  function createCard(project, activePath) {
    const card = document.createElement("article");
    card.className = "komorebi-wallpaper-card";
    card.classList.toggle("active", project.filePath === activePath);
    card.komorebiProject = project;
    card.addEventListener("contextmenu", event => {
      event.preventDefault();
      openProjectContextMenu(project, event);
    });

    const selectButton = document.createElement("button");
    selectButton.className = "komorebi-wallpaper-select";
    selectButton.type = "button";
    // Projects marked unsupported still get a working select button: most
    // of them are genuine `type: "scene"` projects like any other, just
    // missing/mismatched their .pkg file (packageIssue) rather than being a
    // fundamentally different format — trying anyway surfaces the real
    // error (see SceneLoader's load errors) instead of hiding it behind a
    // dead button. Only "web"/"application" project types are a truly
    // different, unimplemented rendering path (see docs/lacunes-connues.md).
    selectButton.disabled = !project.filePath;
    selectButton.setAttribute("aria-pressed", project.filePath === activePath);

    if (project.previewPath) {
      const preview = document.createElement("img");
      preview.className = "komorebi-wallpaper-preview";
      preview.alt = "";
      preview.src = toFileURI(project.previewPath);
      selectButton.appendChild(preview);
    }

    const title = document.createElement("span");
    title.className = "komorebi-wallpaper-title";
    title.textContent = project.title;
    selectButton.appendChild(title);

    if (project.filePath === activePath) {
      const active = document.createElement("span");
      active.className = "komorebi-active-badge";
      document.l10n.setAttributes(active, "komorebi-active-wallpaper");
      selectButton.appendChild(active);
    }

    if (!project.supported) {
      const status = document.createElement("span");
      status.className = "komorebi-wallpaper-status";
      document.l10n.setAttributes(
        status,
        project.packageIssue
          ? "komorebi-scene-package-mismatch"
          : "komorebi-unsupported-wallpaper"
      );
      selectButton.appendChild(status);
    }
    if (project.filePath) {
      selectButton.addEventListener("click", () => selectProject(project));
    }

    if (project.loadError) {
      const status = document.createElement("span");
      status.className = "komorebi-wallpaper-status error";
      document.l10n.setAttributes(status, "komorebi-wallpaper-load-error");
      selectButton.appendChild(status);
    }

    const favoriteButton = document.createElement("button");
    favoriteButton.className = "komorebi-favorite-button";
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
    favoriteButton.textContent = favorites.has(project.directory) ? "★" : "☆";
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

    return card;
  }

  function renderProjects() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const type = typeFilter.value;
    const tag = tagFilter.value;
    const activePath = Services.prefs.getStringPref(ACTIVE_PREF, "");
    const visibleProjects = projects.filter(project => {
      const matchesType =
        type === "all" ||
        (type === "unsupported" ? !project.supported : project.type === type);
      return (
        (!query || project.title.toLocaleLowerCase().includes(query)) &&
        matchesType &&
        (!tag || project.tags.includes(tag)) &&
        (!favoritesFilter.checked || favorites.has(project.directory))
      );
    });
    const fragment = document.createDocumentFragment();
    for (const project of visibleProjects) {
      fragment.appendChild(createCard(project, activePath));
    }
    grid.replaceChildren(fragment);
    emptyState.hidden = Boolean(visibleProjects.length);
    const selection = visibleProjects.find(
      project => project.directory === selectedProject?.directory
    );
    selectProject(
      selection ||
        visibleProjects.find(project => project.filePath === activePath) ||
        null
    );
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

  async function refresh() {
    const scannedProjects = await Promise.all(
      librarySources.map(source => scanLibrary(source))
    );
    projects = [
      ...new Map(
        scannedProjects
          .flat()
          .filter(project => !hiddenProjects.has(project.directory))
          .map(project => [project.directory, project])
      ).values(),
    ];
    updateTagFilter();
    renderProjects();
    renderFolders();
  }

  function openProjectContextMenu(project, event) {
    const menu = document.getElementById("komorebi-project-context-menu");
    menu.komorebiProject = project;
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
    document.l10n.setAttributes(removeItem, "komorebi-hide-wallpaper");
    removeItem.addEventListener("command", () => {
      const project = menu.komorebiProject;
      hiddenProjects.add(project.directory);
      favorites.delete(project.directory);
      saveHiddenProjects();
      saveFavorites();
      if (selectedProject === project) {
        selectedProject = null;
      }
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

    if (!librarySources.includes(picker.file.path)) {
      librarySources.push(picker.file.path);
      saveLibrarySources();
    }
    await refresh();
  }

  function renderFolders() {
    const fragment = document.createDocumentFragment();
    for (const source of librarySources) {
      const row = document.createElement("li");
      row.className = "komorebi-folder-row";

      const path = document.createElement("span");
      path.textContent = source;
      path.title = source;

      const removeButton = document.createElement("moz-button");
      removeButton.setAttribute("type", "default");
      document.l10n.setAttributes(removeButton, "komorebi-remove-folder");
      removeButton.addEventListener("click", async () => {
        librarySources = librarySources.filter(
          pathValue => pathValue !== source
        );
        saveLibrarySources();
        await refresh();
      });
      row.append(path, removeButton);
      fragment.appendChild(row);
    }
    foldersList.replaceChildren(fragment);
  }

  function showFolders() {
    libraryView.hidden = true;
    settingsView.hidden = true;
    foldersView.hidden = false;
    renderFolders();
  }

  function showLibrary() {
    foldersView.hidden = true;
    settingsView.hidden = true;
    libraryView.hidden = false;
  }

  function showSettings() {
    libraryView.hidden = true;
    foldersView.hidden = true;
    settingsView.hidden = false;
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

  function createVideoControls() {
    const settings = getVideoSettings();
    const controls = document.createElement("section");
    controls.className = "komorebi-video-controls";

    const heading = document.createElement("h3");
    document.l10n.setAttributes(heading, "komorebi-video-controls");

    const body = document.createElement("div");
    body.className = "komorebi-video-controls-grid";

    const pause = document.createElement("input");
    pause.type = "checkbox";
    pause.checked = settings.paused;
    addControl(body, "komorebi-pause-video", pause, () => {
      Services.prefs.setBoolPref(`${VIDEO_PREF}paused`, pause.checked);
      updateRendererSettings();
    });

    const muted = document.createElement("input");
    muted.type = "checkbox";
    muted.checked = settings.muted;
    addControl(body, "komorebi-mute-video", muted, () => {
      Services.prefs.setBoolPref(`${VIDEO_PREF}muted`, muted.checked);
      updateRendererSettings();
    });

    const volume = document.createElement("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "1";
    volume.step = "0.05";
    volume.value = settings.volume;
    addControl(body, "komorebi-volume", volume, () => {
      const value = Number(volume.value);
      Services.prefs.setFloatPref(`${VIDEO_PREF}volume`, value);
      if (value > 0 && muted.checked) {
        muted.checked = false;
        Services.prefs.setBoolPref(`${VIDEO_PREF}muted`, false);
      }
      updateRendererSettings();
    });

    const fit = createSelect(
      "komorebi-fit",
      [
        ["cover", "komorebi-fit-cover"],
        ["contain", "komorebi-fit-contain"],
        ["stretch", "komorebi-fit-stretch"],
      ],
      settings.fit
    );
    addControl(body, "komorebi-fit-mode", fit, () => {
      Services.prefs.setStringPref(`${VIDEO_PREF}fit`, fit.value);
      updateRendererSettings();
    });

    const fps = createSelect(
      "komorebi-fps",
      [
        ["15", "komorebi-fps-15"],
        ["30", "komorebi-fps-30"],
        ["60", "komorebi-fps-60"],
      ],
      String(settings.maxFPS)
    );
    addControl(body, "komorebi-fps-limit", fps, () => {
      Services.prefs.setIntPref(`${VIDEO_PREF}maxFPS`, Number(fps.value));
      updateRendererSettings();
    });

    controls.append(heading, body);
    return controls;
  }

  function addControl(container, labelId, control, onChange) {
    const label = document.createElement("label");
    if (control.type === "checkbox") {
      label.className = "komorebi-checkbox-control";
    }
    const text = document.createElement("span");
    document.l10n.setAttributes(text, labelId);
    label.append(text, control);
    control.addEventListener(
      control.type === "range" ? "input" : "change",
      onChange
    );
    container.appendChild(label);
  }

  function updateRendererSettings() {
    const settings = getVideoSettings();
    renderers.scene.updateSettings(settings);
    renderers.video.updateSettings(settings);
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
        renderers.scene.setVisible(true);
      }
      return applied;
    }

    const applied = await renderers.video.load(toFileURI(project.filePath));
    if (applied) {
      renderers.scene.setVisible(false);
      renderers.video.setVisible(true);
    }
    return applied;
  }

  function createDialog() {
    dialog = document.createElement("dialog");
    dialog.id = "komorebi-library-dialog";
    document.l10n.setAttributes(dialog, "komorebi-library-dialog");

    const header = document.createElement("header");
    header.className = "komorebi-library-header";

    const heading = document.createElement("h2");
    document.l10n.setAttributes(heading, "komorebi-library-title");
    header.appendChild(heading);

    const headerActions = document.createElement("div");
    headerActions.className = "komorebi-header-actions";

    const manageButton = document.createElement("moz-button");
    manageButton.setAttribute("type", "default");
    document.l10n.setAttributes(manageButton, "komorebi-manage-folders");
    manageButton.addEventListener("click", showFolders);

    const settingsButton = document.createElement("moz-button");
    settingsButton.setAttribute("type", "default");
    document.l10n.setAttributes(settingsButton, "komorebi-video-settings");
    settingsButton.addEventListener("click", showSettings);

    const chooseButton = document.createElement("moz-button");
    chooseButton.setAttribute("type", "default");
    document.l10n.setAttributes(chooseButton, "komorebi-add-folder");
    chooseButton.addEventListener("click", addLibrarySource);
    const closeButton = document.createElement("moz-button");
    closeButton.setAttribute("type", "default");
    document.l10n.setAttributes(closeButton, "komorebi-close-library");
    closeButton.addEventListener("click", () => dialog.close());
    headerActions.append(
      manageButton,
      settingsButton,
      chooseButton,
      closeButton
    );
    header.appendChild(headerActions);

    const filters = document.createElement("div");
    filters.className = "komorebi-library-filters";

    searchInput = document.createElement("input");
    searchInput.type = "search";
    document.l10n.setAttributes(searchInput, "komorebi-search-wallpapers");
    searchInput.addEventListener("input", renderProjects);

    typeFilter = createSelect(
      "komorebi-type-filter",
      [
        ["all", "komorebi-all-types"],
        ["video", "komorebi-video-type"],
        ["scene", "komorebi-scene-type"],
        ["unsupported", "komorebi-unsupported-type"],
      ],
      "all"
    );
    typeFilter.addEventListener("change", renderProjects);

    tagFilter = document.createElement("select");
    tagFilter.id = "komorebi-tag-filter";
    tagFilter.addEventListener("change", renderProjects);

    const favoriteLabel = document.createElement("label");
    favoriteLabel.className = "komorebi-favorites-filter";
    const favoriteText = document.createElement("span");
    document.l10n.setAttributes(favoriteText, "komorebi-favorites-only");
    favoritesFilter = document.createElement("input");
    favoritesFilter.type = "checkbox";
    favoritesFilter.addEventListener("change", renderProjects);
    favoriteLabel.append(favoritesFilter, favoriteText);
    filters.append(searchInput, typeFilter, tagFilter, favoriteLabel);

    grid = document.createElement("div");
    grid.className = "komorebi-wallpaper-grid";

    emptyState = document.createElement("p");
    emptyState.className = "komorebi-empty-state";
    document.l10n.setAttributes(emptyState, "komorebi-library-empty");

    const footer = document.createElement("footer");
    footer.className = "komorebi-library-footer";

    const cancelButton = document.createElement("moz-button");
    cancelButton.setAttribute("type", "default");
    document.l10n.setAttributes(cancelButton, "komorebi-library-cancel");
    cancelButton.addEventListener("click", () => dialog.close());

    useButton = document.createElement("moz-button");
    useButton.setAttribute("type", "primary");
    useButton.disabled = true;
    document.l10n.setAttributes(useButton, "komorebi-use-wallpaper");
    useButton.addEventListener("click", async () => {
      const project = selectedProject;
      project.loadError = false;
      useButton.disabled = true;
      applyingPath = project.filePath;
      try {
        const applied = await loadProject(project);
        if (!applied) {
          return;
        }
        Services.prefs.setStringPref(ACTIVE_PREF, project.filePath);
        Services.prefs.setStringPref(ACTIVE_TYPE_PREF, project.type);
        dialog.close();
      } catch (error) {
        console.error("Komorebi could not apply the wallpaper", error);
        project.loadError = true;
        renderProjects();
      } finally {
        if (applyingPath === project.filePath) {
          applyingPath = null;
          useButton.disabled = selectedProject === null;
        }
      }
    });
    footer.append(cancelButton, useButton);

    libraryView = document.createElement("section");
    libraryView.className = "komorebi-library-view";
    libraryView.append(filters, grid, emptyState, footer);

    foldersView = document.createElement("section");
    foldersView.className = "komorebi-folders-view";
    foldersView.hidden = true;

    const foldersHeader = document.createElement("div");
    foldersHeader.className = "komorebi-folders-header";
    const backButton = document.createElement("moz-button");
    backButton.setAttribute("type", "default");
    document.l10n.setAttributes(backButton, "komorebi-back-to-library");
    backButton.addEventListener("click", showLibrary);
    const foldersHeading = document.createElement("h3");
    document.l10n.setAttributes(foldersHeading, "komorebi-folder-sources");
    foldersHeader.append(backButton, foldersHeading);

    foldersList = document.createElement("ul");
    foldersList.className = "komorebi-folders-list";
    foldersView.append(foldersHeader, foldersList);

    settingsView = document.createElement("section");
    settingsView.className = "komorebi-settings-view";
    settingsView.hidden = true;
    const settingsHeader = document.createElement("div");
    settingsHeader.className = "komorebi-folders-header";
    const settingsBackButton = document.createElement("moz-button");
    settingsBackButton.setAttribute("type", "default");
    document.l10n.setAttributes(settingsBackButton, "komorebi-back-to-library");
    settingsBackButton.addEventListener("click", showLibrary);
    settingsHeader.appendChild(settingsBackButton);
    settingsView.append(settingsHeader, createVideoControls());

    const content = document.createElement("section");
    content.className = "komorebi-library-content";
    content.append(header, libraryView, foldersView, settingsView);
    dialog.appendChild(content);
    document.body.appendChild(dialog);
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

  async function init(config) {
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
    await IOUtils.makeDirectory(defaultPath, { createAncestors: true });

    createProjectContextMenu();
    createDialog();
    createAppMenuButton();
    updateRendererSettings();
    await refresh();

    const activeWallpaperObserver = async () => {
      const path = Services.prefs.getStringPref(ACTIVE_PREF, "");
      if (path === applyingPath) {
        renderProjects();
        return;
      }
      if (path && (await IOUtils.exists(path))) {
        try {
          const project = projects.find(item => item.filePath === path);
          if (project) {
            await loadProject(project);
          }
          renderProjects();
        } catch (error) {
          console.error("Komorebi could not load the active wallpaper", error);
        }
      }
    };
    Services.prefs.addObserver(ACTIVE_PREF, activeWallpaperObserver);
    window.addEventListener(
      "unload",
      () => Services.prefs.removeObserver(ACTIVE_PREF, activeWallpaperObserver),
      { once: true }
    );

    const activePath = Services.prefs.getStringPref(ACTIVE_PREF, "");
    if (activePath && (await IOUtils.exists(activePath))) {
      const project = projects.find(item => item.filePath === activePath);
      if (project) {
        try {
          await loadProject(project);
        } catch (error) {
          console.error("Komorebi could not restore the wallpaper", error);
        }
      }
    }
  }

  function open() {
    dialog.showModal();
    refresh();
  }

  global.KomorebiLibrary = { init, open };
})(this);
