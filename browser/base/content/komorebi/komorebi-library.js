(function (global) {
  "use strict";

  const LEGACY_LIBRARY_PREF = "browser.komorebi.libraryPath";
  const LIBRARY_SOURCES_PREF = "browser.komorebi.librarySources";
  const ACTIVE_PREF = "browser.komorebi.activeWallpaper";
  const SUPPORTED_VIDEO_TYPES = new Set(["mp4", "webm", "ogg", "ogv"]);

  let onSelect;
  let dialog;
  let grid;
  let emptyState;
  let librarySources;
  let selectedProject;
  let useButton;

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

  async function readProject(directory) {
    const projectPath = PathUtils.join(directory, "project.json");
    if (!(await IOUtils.exists(projectPath))) {
      return null;
    }

    try {
      const project = await IOUtils.readJSON(projectPath);
      const extension = (project.file || "")
        .split(/[\\/]/)
        .pop()
        .split(".")
        .pop()
        .toLowerCase();
      const supported =
        project.type === "video" && SUPPORTED_VIDEO_TYPES.has(extension);
      const filePath = resolveAssetPath(directory, project.file);
      const previewPath = resolveAssetPath(directory, project.preview);

      return {
        directory,
        filePath,
        id: PathUtils.filename(directory),
        previewPath,
        supported: supported && Boolean(filePath),
        title: project.title || PathUtils.filename(directory),
        type: project.type || "unknown",
      };
    } catch (error) {
      console.error(`Komorebi could not read ${projectPath}`, error);
      return null;
    }
  }

  async function scanLibrary(path) {
    const rootProject = await readProject(path);
    if (rootProject) {
      return [rootProject];
    }

    const projects = [];
    for (const child of await IOUtils.getChildren(path, {
      ignoreAbsent: true,
    })) {
      const info = await IOUtils.stat(child);
      if (info.type !== "directory") {
        continue;
      }
      const project = await readProject(child);
      if (project) {
        projects.push(project);
      }
    }
    return projects;
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
      card.setAttribute(
        "aria-pressed",
        card.komorebiProject === selectedProject
      );
    }
  }

  function createCard(project, activePath) {
    const card = document.createElement("button");
    card.className = "komorebi-wallpaper-card";
    card.type = "button";
    card.disabled = !project.supported;
    card.setAttribute("aria-pressed", project.filePath === activePath);
    card.komorebiProject = project;

    if (project.previewPath) {
      const preview = document.createElement("img");
      preview.className = "komorebi-wallpaper-preview";
      preview.alt = "";
      preview.src = toFileURI(project.previewPath);
      card.appendChild(preview);
    }

    const title = document.createElement("span");
    title.className = "komorebi-wallpaper-title";
    title.textContent = project.title;
    card.appendChild(title);

    if (!project.supported) {
      const status = document.createElement("span");
      status.className = "komorebi-wallpaper-status";
      document.l10n.setAttributes(
        status,
        project.type === "scene"
          ? "komorebi-scene-coming-soon"
          : "komorebi-unsupported-wallpaper"
      );
      card.appendChild(status);
    } else {
      card.addEventListener("click", () => selectProject(project));
    }

    return card;
  }

  async function refresh() {
    const scannedProjects = await Promise.all(
      librarySources.map(source => scanLibrary(source))
    );
    const projects = [
      ...new Map(
        scannedProjects.flat().map(project => [project.directory, project])
      ).values(),
    ];
    const activePath = Services.prefs.getStringPref(ACTIVE_PREF, "");
    const fragment = document.createDocumentFragment();
    for (const project of projects) {
      fragment.appendChild(createCard(project, activePath));
    }
    grid.replaceChildren(fragment);
    emptyState.hidden = Boolean(projects.length);
    selectProject(
      projects.find(project => project.filePath === activePath) || null
    );
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

  function createDialog() {
    dialog = document.createElement("dialog");
    dialog.id = "komorebi-library-dialog";
    document.l10n.setAttributes(dialog, "komorebi-library-dialog");

    const header = document.createElement("header");
    header.className = "komorebi-library-header";

    const heading = document.createElement("h2");
    document.l10n.setAttributes(heading, "komorebi-library-title");
    header.appendChild(heading);

    const chooseButton = document.createElement("moz-button");
    chooseButton.setAttribute("type", "default");
    document.l10n.setAttributes(chooseButton, "komorebi-add-folder");
    chooseButton.addEventListener("click", addLibrarySource);
    header.appendChild(chooseButton);

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
      const activePath = Services.prefs.getStringPref(ACTIVE_PREF, "");
      Services.prefs.setStringPref(ACTIVE_PREF, selectedProject.filePath);
      if (activePath === selectedProject.filePath) {
        await onSelect(toFileURI(selectedProject.filePath));
      }
      dialog.close();
    });
    footer.append(cancelButton, useButton);

    const content = document.createElement("section");
    content.className = "komorebi-library-content";
    content.append(header, grid, emptyState, footer);
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

  async function init(selectCallback) {
    onSelect = selectCallback;
    global.MozXULElement.insertFTLIfNeeded("browser/komorebi.ftl");

    const defaultPath = PathUtils.join(
      PathUtils.profileDir,
      "komorebi",
      "wallpapers"
    );
    librarySources = loadLibrarySources(defaultPath);
    saveLibrarySources();
    await IOUtils.makeDirectory(defaultPath, { createAncestors: true });

    createDialog();
    createAppMenuButton();
    await refresh();

    const activeWallpaperObserver = async () => {
      const path = Services.prefs.getStringPref(ACTIVE_PREF, "");
      if (path && (await IOUtils.exists(path))) {
        await onSelect(toFileURI(path));
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
      await onSelect(toFileURI(activePath));
    }
  }

  function open() {
    dialog.showModal();
    refresh();
  }

  global.KomorebiLibrary = { init, open };
})(this);
