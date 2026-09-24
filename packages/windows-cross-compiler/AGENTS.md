# windows-cross-compiler constraints

- Output is compile and package evidence only. Never report a Windows runtime
  claim from this image; the consuming package owns runtime verification.
- The `winui` image runs Microsoft's own Windows tools under Wine. Fix a Wine
  gap with a patch in `wine-patches/` against the pinned `WINE_VERSION`; do not
  replace a Microsoft tool with a reimplementation.
- `WINE_VERSION` and `WINEHQ_PACKAGE_VERSION` move together, and every patch
  must apply with `--fuzz=0`. `RUST_VERSION` and `DOTNET_SDK_VERSION` follow
  the repository pins; `src/pins.test.ts` enforces all of this.
- The `base` stage must stay free of Wine and must build on linux/amd64 and
  linux/arm64: every host-specific download covers both architectures with its
  own checksum. `winui` is linux/amd64 only.
- A behavior change needs a sample and a `test/selftest-*.sh` assertion that
  exercises it.
- Consumers pin images by digest from `images/*/DIGEST`; never reference a
  mutable tag.
