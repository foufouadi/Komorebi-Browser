# Komorebi Browser

> A next-generation browser that turns the Web into a living digital
> environment.

Komorebi Browser is an experimental Firefox fork built around a simple idea:
the browser should be more than a window onto the Internet. It can become a
personal, interactive, and fully customizable space.

Inspired by Wallpaper Engine, Rainmeter, and modern graphics engines, Komorebi
aims to bring Web browsing, animated scenes, widgets, and creative tools
together in a single experience.

## Demo

https://github.com/user-attachments/assets/d7341e54-3858-46b1-8716-e5c5a166c3c0

## Current status

Komorebi now renders Wallpaper Engine scenes natively, not just video:

- a WebGL1 scene engine (layers, effects, particle systems, spritesheet
  animation, scene audio playback) alongside the original video wallpaper
  path, both behind browser tabs;
- an HLSL-to-GLSL ES 1.00 shader transpiler and effect library (water,
  shake, foliage, iris, tint, pulse, scroll, transform, blend...) covering
  most stock Wallpaper Engine effects;
- binary format parsers for Wallpaper Engine's `.pkg`/`.tex`/`.mdl` assets;
- a wallpaper library and picker (search, tags, favorites, folder
  management, per-project settings);
- transparent home, new-tab, and welcome pages;
- transparent Google results with an adaptive readability overlay;
- light and dark appearance support;
- an isolated implementation designed to simplify Firefox updates.

See [Known limitations](#known-limitations) for what the scene engine
doesn't cover yet.

## Vision

Komorebi ultimately aims to provide a complete scene engine capable of
rendering:

- videos and animated wallpapers — **done**;
- 2D scenes with particles, shaders, and effects — **done** for Wallpaper
  Engine-authored content, see Current status above;
- interactive 3D environments and WebGPU scenes — not started;
- widgets embedded into the environment;
- complete themes combining scenes, browser UI, sounds, and animations.

A scene will follow a modular structure:

```text
Scene
|-- Background
|-- Objects
|-- Effects
|-- Audio
|-- Widgets
`-- Interactions
```

Each element will be independently configurable, animatable, and triggerable.

## Creation and interaction

The goal is to provide a visual editor with features such as:

- drag-and-drop objects and layer management;
- an animation timeline;
- property and effect editors;
- particle and shader creation tools;
- settings exposed to end users.

Scenes will be able to react to the mouse, keyboard, music, and selected system
events. Planned widgets include a clock, weather, calendar, notes, a music
player, shortcuts, and performance indicators.

## Community platform

The long-term vision includes a community creation platform where users can
publish, download, rate, remix, and share scenes, themes, and assets.

## Performance

Komorebi is intended to preserve browser responsiveness and battery life
through:

- GPU-accelerated rendering where appropriate;
- adaptive quality and frame rates;
- automatic pausing in full-screen applications or games;
- reduced battery and background resource usage;
- progressive loading of scenes and assets.

## Roadmap

1. ~~Stabilize the video wallpaper and browser transparency.~~ Done.
2. ~~Define the project format and scene system.~~ Done (Wallpaper Engine
   `.pkg`/scene.json format).
3. ~~Add 2D rendering, effects, and interactions.~~ Done for Wallpaper
   Engine-authored scenes; native Komorebi scene authoring not started.
4. Build the visual editor and animation timeline.
5. Introduce widgets and complete themes.
6. Explore WebGPU and 3D rendering.
7. Design the community sharing platform.

This roadmap describes a research direction. Steps 4-7 have not been
implemented yet.

## Known limitations

The scene engine targets WebGL1 (GLSL ES 1.00) and doesn't implement every
Wallpaper Engine feature:

- no audio-reactive effects (no system audio capture/FFT pipeline);
- no skeletal animation for puppet-warp meshes (static rest pose only);
- no `web`/`application`-type projects (video and scene only);
- effects requiring GLSL ES 3.00 (WebGL2) don't compile;
- no automatic camera projection or camera parallax.

## Current architecture

The implementation is isolated in
[`browser/base/content/komorebi`](browser/base/content/komorebi/).
Only two integration points are added to Firefox itself:

1. `browser/base/content/browser.xhtml` loads the Komorebi entry point.
2. `browser/base/jar.mn` includes the Komorebi resource manifest.

The scene engine (`dist/`) is written in TypeScript and compiled with
`npx tsc -p src/tsconfig.build.json` from
`browser/base/content/komorebi`; only the compiled `dist/` output is part
of the Firefox build. Wallpapers are selected through the in-browser
library picker (persisted in the `activeWallpaper` preference), not a
hardcoded path.

## Build and run

Start by following Mozilla's
[Firefox build instructions](https://firefox-source-docs.mozilla.org/setup/),
then run:

```powershell
./mach build
./mach run
```

For later front-end-only changes:

```powershell
./mach build faster
```

## Project and licensing

Komorebi Browser is based on the open-source
[Mozilla Firefox](https://www.mozilla.org/firefox/) codebase. It is an
independent experimental project and is not an official Mozilla product.

The license for Komorebi's original components has not yet been selected.
Code inherited from Firefox retains its respective licenses.
