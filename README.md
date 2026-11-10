# Komorebi Browser

> An experimental Firefox fork with animated wallpapers behind your tabs.

Komorebi runs Wallpaper Engine scenes, videos and your own images behind the
browser interface and web pages. Scenes are not converted to video: their
assets, effects and scripts are parsed and rendered directly in the browser.

## Demo

https://github.com/user-attachments/assets/434cdabe-d264-4f9e-99a4-db01065f25e5

## Download

Get `Komorebi-Browser-Setup.exe` from the
[latest release](https://github.com/foufouadi/Komorebi-Browser/releases/latest)
and run it. It installs for the current user, with no administrator rights, and
adds a desktop shortcut.

The installer is not signed, so Windows SmartScreen may warn you the first time.

Komorebi updates itself from its settings: it downloads the new
release, checks it and reinstalls over the same folder, keeping your profile.
Version 0.1.0 has no updater, so install the next release over it once by hand.

Windows x64 only.

## Features

### Wallpapers

- Wallpaper Engine scenes, video wallpapers, and your own images and videos
  (drop them on the library or use Add file)
- Automatic detection of wallpapers from the Steam Workshop
- Library with search, tags, favorites, folders, and sorting by date or name
- Scene effects compiled with WebGL2, including most Workshop shaders
- Composition layers, text layers, sprite sheets, particles and puppet
  skeletons
- Scene scripts (SceneScript), run in an isolated sandbox with no network or
  browser access
- Per-wallpaper settings, and scene music with its own volume
- Guided first launch to choose a wallpaper

### Browser

- Wallpaper visible behind the Home page, New Tab and Google results
- Readable Google results on translucent blocks, with adjustable opacity; the
  Firefox background when the wallpaper is turned off for search
- Import of your bookmarks, history and other data from Chrome or Firefox
- Spaces to group tabs
- Compact mode that hides the toolbar until needed
- Unloading of tabs you have not used for a while
- Notes, focus timer and break mode

### Performance

- The wallpaper runs in its own process, with hardware video decoding
- Eco, Balanced, Performance and Custom power modes (15 to 60 FPS)
- Pauses when the wallpaper is hidden, such as behind a fullscreen application

## Known limitations

- `web` and `application` Wallpaper Engine projects, presets of another
  wallpaper, and 3D scenes are not supported.
- No audio-reactive effects: audio bars and pulses stay still.
- A wallpaper's own options (clock format, colors...) use their defaults and
  cannot be changed yet.
- Mouse interaction, parallax and camera shake are new and not yet checked on
  every wallpaper. Particles do not follow the mouse.
- A few Workshop shaders still fail to compile, and some effects drawn on part
  of the screen leave rectangles.
- Importing from Firefox restarts the browser into the Firefox import wizard.
- The Google styling depends on Google's page structure, so some result pages
  can look wrong until it is adapted.
- Web page contents cannot blur the wallpaper behind them.

## License

Komorebi Browser is based on the Mozilla Firefox source code and is an
independent experimental project. It is not affiliated with or endorsed by
Mozilla.

Original Komorebi components (in
[`browser/base/content/komorebi`](browser/base/content/komorebi/)) are
licensed under the Mozilla Public License Version 2.0 (MPL-2.0); see the
[LICENSE](browser/base/content/komorebi/LICENSE) file in that directory.

Code inherited from Firefox remains under its own licenses; see the
top-level [LICENSE](LICENSE) file.
