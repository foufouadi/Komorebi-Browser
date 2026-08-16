# Komorebi Browser

> An experimental Firefox fork that transforms the browser into a GPU-rendered,
> customizable desktop environment.

Komorebi Browser explores a different vision of web browsing. Instead of treating
the browser as a static application, it turns it into a real-time rendered
environment capable of displaying animated wallpapers and interactive scenes
behind browser content.

Inspired by Wallpaper Engine, Rainmeter, and modern graphics engines, Komorebi
integrates a native scene renderer directly into Firefox while remaining as
isolated as possible from upstream.

## Demo

https://github.com/user-attachments/assets/434cdabe-d264-4f9e-99a4-db01065f25e5

---

# Features

### Wallpapers

- Native video wallpapers
- Native Wallpaper Engine scene rendering
- Wallpaper library
- Search, tags and favorites
- Per-wallpaper settings
- Folder management

### Scene engine

- WebGL1 renderer
- Layer system
- Particle systems
- Sprite sheet animation
- Scene audio playback
- Wallpaper Engine shader support
- HLSL → GLSL ES 1.00 shader transpiler
- Built-in effect library
- Binary asset parsers (`.pkg`, `.tex`, `.mdl`)

### Browser integration

- Transparent browser pages
- Transparent Home page
- Transparent New Tab
- Transparent Welcome page
- Transparent Google search
- Adaptive readability overlay
- Light and dark appearance

---

# Current status

Komorebi currently supports two rendering paths.

### Video wallpapers

Native video playback rendered behind browser tabs.

**Status:** Complete.

### Wallpaper Engine scenes

Native rendering of most 2D Wallpaper Engine projects, including:

- layered rendering
- shaders
- particle systems
- sprite animations
- scene audio playback

This is **not** a video conversion. Wallpaper Engine assets are parsed and
rendered directly inside the browser.

**Status:** Functional.

See **Known limitations** for unsupported Wallpaper Engine features.

---

# Vision

Komorebi is an experimental research project exploring what a browser can become
when real-time rendering is treated as a first-class feature rather than an
afterthought.

Current development focuses on improving Wallpaper Engine compatibility,
rendering accuracy, performance, and browser integration while keeping the
implementation as isolated as possible from Firefox itself.

Future work may eventually explore native scene creation, widgets, and more
advanced rendering technologies, but these are long-term research directions
rather than planned features.

---

# Performance

Komorebi is designed to preserve browser responsiveness through:

- GPU-accelerated rendering
- adaptive quality
- adaptive frame rate
- progressive asset loading
- automatic pausing during fullscreen applications
- reduced battery usage
- reduced background activity

---

# Current architecture

Komorebi is intentionally isolated from Firefox itself.

Only two Firefox files are modified:

1. `browser/base/content/browser.xhtml`
2. `browser/base/jar.mn`

Everything else lives inside:

```
browser/base/content/komorebi/
```

The renderer is written in TypeScript and compiled into JavaScript before
Firefox is built.

```
Firefox
│
├── browser.xhtml
├── jar.mn
└── Komorebi
    ├── Renderer
    ├── Scene Engine
    ├── Asset Parsers
    ├── Wallpaper Library
    └── UI
```

This architecture minimizes merge conflicts with future Firefox releases.

---

# Roadmap

Completed:

- ✅ Browser transparency
- ✅ Video wallpapers
- ✅ Wallpaper Engine scene renderer
- ✅ Wallpaper Engine asset parsers
- ✅ Effect system
- ✅ Wallpaper library

Current priorities:

- Improve Wallpaper Engine compatibility
- Expand effect coverage
- Improve rendering accuracy
- Continue performance optimizations
- Improve browser integration

---

# Known limitations

The current scene engine targets WebGL1 (GLSL ES 1.00) and does not implement
every Wallpaper Engine feature.

Current limitations include:

- no audio-reactive effects
- no skeletal animation for puppet-warp meshes
- no `web` or `application` Wallpaper Engine projects
- effects requiring GLSL ES 3.00 (WebGL2) are unsupported
- no automatic camera projection
- no automatic camera parallax

---

## Build and run

Follow Mozilla's
[Firefox build instructions](https://firefox-source-docs.mozilla.org/setup/),
then run:

```powershell
./mach build
./mach run
```

For front-end-only changes to Komorebi, `./mach build faster` skips
C++/Rust compilation. The scene engine itself is TypeScript, compiled
separately with `npx tsc -p src/tsconfig.build.json` from
`browser/base/content/komorebi`.

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
