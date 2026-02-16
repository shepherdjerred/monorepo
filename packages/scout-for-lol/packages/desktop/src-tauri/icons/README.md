# Icons Placeholder

This directory needs icon files for the application. The following files are required:

- `32x32.png` - 32x32 pixel PNG icon
- `128x128.png` - 128x128 pixel PNG icon
- `128x128@2x.png` - 256x256 pixel PNG icon for retina displays
- `icon.icns` - macOS icon file
- `icon.ico` - Windows icon file

You can use the Tauri CLI to generate these from a source image:

```bash
bunx tauri icon path/to/source-icon.png
```

For now, the build will work without these, but the application icon will be the default Tauri icon.
