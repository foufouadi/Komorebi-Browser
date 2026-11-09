# Komorebi Browser

> An experimental Firefox fork with animated wallpapers behind your tabs.

Komorebi runs Wallpaper Engine scenes and video wallpapers behind the browser
interface and web pages. Scenes are not converted to video: their assets are
parsed and rendered directly in the browser.

## Demo

https://github.com/user-attachments/assets/434cdabe-d264-4f9e-99a4-db01065f25e5

## Download

Get `Komorebi-Browser-Setup.exe` from the
[latest release](https://github.com/foufouadi/Komorebi-Browser/releases/latest)
and run it. It installs for the current user, with no administrator rights, and
adds a desktop shortcut.

The installer is not signed, so Windows SmartScreen may warn you the first time.
Komorebi does not update itself: install a newer release over the old one.

Windows x64 only.

## Features

### Wallpapers

- Video wallpapers and Wallpaper Engine scenes
- Automatic detection of wallpapers from the Steam Workshop
- Library with search, tags, favorites and folders
- Per-wallpaper settings, and scene music with its own volume
- Guided first launch to choose a wallpaper

### Browser

- Wallpaper visible behind the Home page, New Tab and Google results
- Readable Google results on translucent blocks, with adjustable opacity
- Spaces to group tabs
- Compact mode that hides the toolbar until needed
- Unloading of tabs you have not used for a while
- Notes, focus timer and break mode

### Performance

- The wallpaper runs in its own process, with hardware video decoding
- Eco, Balanced, Performance and Custom power modes (15 to 60 FPS)
- Pauses when the wallpaper is hidden, such as behind a fullscreen application

## Known limitations

- `web` and `application` Wallpaper Engine projects are not supported.
- Scene effects that need WebGL2 (GLSL ES 3.00) are not supported.
- No audio-reactive effects.
- No skeletal animation for puppet-warp meshes.
- No automatic camera projection or parallax.
- The Google styling depends on Google's page structure, so some result pages
  can look wrong until it is adapted.
- Web page contents cannot blur the wallpaper behind them.

## Build from source

Install [MozillaBuild](https://firefox-source-docs.mozilla.org/setup/), then
run `./mach build` and `./mach run`. For changes to Komorebi's front-end files,
`./mach build faster` is enough.

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
