<div align="center">

<img src="browser/branding/komorebi/logo/komorebi-icon.svg" width="96" alt="Komorebi logo">

# Komorebi Browser

**A Firefox-based browser that brings your desktop wallpapers into the browser.**

[![Latest release](https://img.shields.io/github/v/release/foufouadi/Komorebi-Browser?label=release&color=6E5BC4)](https://github.com/foufouadi/Komorebi-Browser/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/foufouadi/Komorebi-Browser/total?color=E8907E)](https://github.com/foufouadi/Komorebi-Browser/releases)
[![Stars](https://img.shields.io/github/stars/foufouadi/Komorebi-Browser?color=8C80DA)](https://github.com/foufouadi/Komorebi-Browser/stargazers)
![Windows 10 | 11](https://img.shields.io/badge/Windows-10%20%7C%2011-1C1B22)
[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-B28FDB)](browser/base/content/komorebi/LICENSE)

### [⬇ Download Komorebi-Browser-Setup.exe](https://github.com/foufouadi/Komorebi-Browser/releases/latest/download/Komorebi-Browser-Setup.exe)

</div>

Komorebi lets you use your Wallpaper Engine wallpapers directly in your browser. Instead of a static background, your home page, new tabs and search results can display the same scenes, videos and images you use on your desktop.

Wallpapers run behind your pages, with mouse interaction and audio support for compatible wallpapers. You can also add your own images and videos without having Wallpaper Engine installed.

https://github.com/user-attachments/assets/434cdabe-d264-4f9e-99a4-db01065f25e5

## Features

- **Wallpaper Engine support**: Automatically detects your existing library, including scenes, videos and images.
- **Custom wallpapers**: Add your own images and videos.
- **Mouse interaction**: Compatible wallpapers respond to mouse movement, just like they do on your desktop.
- **Transparent search results**: Google results appear on translucent cards, keeping your wallpaper visible in the background.
- **Performance controls**: Rendering pauses when a tab isn't visible, and you can limit the CPU/GPU resources used by wallpapers.
- **Automatic updates**: Keeps Komorebi up to date with the latest Firefox releases.
- **Browser migration**: Import your bookmarks and browsing history from Chrome or Firefox.

## Installation

1. Download [`Komorebi-Browser-Setup.exe`](https://github.com/foufouadi/Komorebi-Browser/releases/latest/download/Komorebi-Browser-Setup.exe).
2. Run the installer. Administrator privileges aren't required.
3. Open Komorebi and select a wallpaper from your library.

**Windows SmartScreen warning**

The installer is not signed yet, so Windows SmartScreen may show a warning when you first run it.

If this happens, click **More info** and then **Run anyway**.

## Requirements

- Windows 10 or Windows 11.
- Wallpaper Engine is optional. You only need it if you want to use your existing Wallpaper Engine library.
- Without Wallpaper Engine, you can still use Komorebi with your own images and videos.

## Roadmap

Some things I'd like to add or improve:

- Audio-reactive wallpapers.
- More wallpaper customization options, such as clocks and colors.
- Support for web, application and 3D wallpapers.
- Better rendering compatibility with complex Wallpaper Engine scenes.

## Reporting issues

Some wallpapers may not render exactly as they do on the desktop, especially more complex scenes.

If you run into rendering issues, please [open an issue](https://github.com/foufouadi/Komorebi-Browser/issues) and include a screenshot and the name of the wallpaper. This makes it easier to investigate.

## License

Komorebi is an independent project based on Firefox. It is not affiliated with, endorsed by, or sponsored by Mozilla or Wallpaper Engine.

Komorebi's own code is located in [`browser/base/content/komorebi`](browser/base/content/komorebi/) and is licensed under **MPL-2.0**.

The rest of the source tree retains its original Firefox licensing. See [LICENSE](LICENSE) for details.
