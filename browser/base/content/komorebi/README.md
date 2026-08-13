# Komorebi

Komorebi is isolated in this directory. It has two integration points in
Firefox:

1. `browser/base/content/browser.xhtml` loads `komorebi-loader.js`.
2. `browser/base/jar.mn` includes `content/komorebi/jar.inc.mn`.

The video path is configured by `VIDEO_PATH` in `komorebi-loader.js`.

After changing the module, rebuild the front end with:

```powershell
./mach build faster
```
