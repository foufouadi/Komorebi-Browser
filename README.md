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

https://github.com/user-attachments/assets/01e4d744-20d6-4e84-bd23-e01fea540e9f

## Current status

The project is currently at its first functional prototype:

- animated video wallpaper behind browser tabs;
- transparent home, new-tab, and welcome pages;
- transparent Google results with an adaptive readability overlay;
- light and dark appearance support;
- an isolated implementation designed to simplify Firefox updates.

## Vision

Komorebi ultimately aims to provide a complete scene engine capable of
rendering:

- videos and animated wallpapers;
- interactive 2D and 3D environments;
- WebGL and WebGPU scenes;
- particle systems;
- custom shaders;
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

1. Stabilize the video wallpaper and browser transparency.
2. Define the project format and scene system.
3. Add 2D rendering, effects, and interactions.
4. Build the visual editor and animation timeline.
5. Introduce widgets and complete themes.
6. Explore WebGL, WebGPU, 3D rendering, and shaders.
7. Design the community sharing platform.

This roadmap describes a research direction. Most of these capabilities have
not been implemented yet.

## Current architecture

The implementation is isolated in
[`browser/base/content/komorebi`](browser/base/content/komorebi/README.md).
Only two integration points are added to Firefox itself:

1. `browser/base/content/browser.xhtml` loads the Komorebi entry point.
2. `browser/base/jar.mn` includes the Komorebi resource manifest.

Set `VIDEO_PATH` in
`browser/base/content/komorebi/komorebi-loader.js` to the local wallpaper
video.

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
