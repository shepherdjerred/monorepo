# windows-cross-compiler

Linux container images that build Windows software: C, C++, Rust, and .NET
for x64 and ARM64 Windows, and Windows App SDK (WinUI 3) apps packaged as MSIX.
Nothing runs on Windows and nothing is signed.

| Image                                                 | Contents                                                                                                     | Hosts                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `ghcr.io/shepherdjerred/windows-cross-compiler`       | clang-cl and lld with the MSVC CRT and Windows SDK, Rust with cargo-xwin, the .NET SDK, NSIS                 | linux/amd64 (the Dockerfile also builds on linux/arm64) |
| `ghcr.io/shepherdjerred/windows-cross-compiler-winui` | The above plus Wine 11.0 and .NET Framework 4.8 running Microsoft's XAML compiler, `makepri`, and `makeappx` | linux/amd64                                             |

Images are published by digest only. Use the digest recorded in
`images/<image>/DIGEST`:

```bash
image="ghcr.io/shepherdjerred/windows-cross-compiler@$(cat images/windows-cross-compiler/DIGEST)"
docker run --rm -v "$PWD:/workspace" "$image" <command>
```

## C and C++

`x86_64-pc-windows-msvc-cl` and `aarch64-pc-windows-msvc-cl` are `clang-cl`
with the target's CRT and SDK headers and libraries already configured. They
take `cl.exe` arguments:

```bash
x86_64-pc-windows-msvc-cl /EHsc hello.cpp /Fehello.exe
```

CMake projects can use the toolchain files under
`/opt/windows-cross/xwin/cmake/clang-cl/`.

## Rust

```bash
cargo xwin build --release --target x86_64-pc-windows-msvc
cargo xwin build --release --target aarch64-pc-windows-msvc
```

The MSVC CRT and Windows SDK are already downloaded into the image; building
it accepts their license. `makensis` is available for NSIS installers, for
example through cargo-packager's `nsis` format.

## .NET

`EnableWindowsTargeting` is set, so `net*-windows` projects restore and build:

```bash
dotnet publish -c Release -r win-x64
dotnet publish -c Release -r win-arm64
```

## WinUI 3 and MSIX

In the `winui` image, import the MSBuild targets last, from a
`Directory.Build.targets`:

```xml
<Import Project="$(WindowsCrossTargets)" Condition="'$(WindowsCrossTargets)' != ''" />
```

Then build and package as on Windows, for example:

```bash
dotnet build -c Release -r win-x64 -p:Platform=x64 \
  -p:GenerateAppxPackageOnBuild=true -p:AppxPackageDir=/workspace/AppPackages/
```

The targets run the stock .NET Framework `XamlCompiler.exe` (which also
compiles XAML to XBF) and the Windows SDK's `makepri` and `makeappx` under Wine
through generated shims. Because the MSBuild process is .NET on Linux,
packaged resources are mapped from `makepri dump` output instead of loading
`MrmSupport.dll`, the path the MSIX tooling already takes where the resource
indexer API is unavailable.

Wine 11.0 needs these patches (`wine-patches/`) for those tools:

| Patch                                                                              | Tool that needs it                |
| ---------------------------------------------------------------------------------- | --------------------------------- |
| `shcore` forwards ordinal 170 (`PathIsNetworkPathW`)                               | `makepri`                         |
| `msxml3` validates documents built through the DOM                                 | `makepri`                         |
| `msxml3` `MXXMLWriter` accepts a document locator                                  | `makepri dump`                    |
| `ntdll` AVL generic tables                                                         | `makeappx` and its packaging DLLs |
| `msxml3` SAX attribute types and XML declaration properties                        | `makeappx`                        |
| `msxml3` schema collections compile across namespaces when `validateOnLoad` is off | `makeappx` manifest validation    |

### Limitations

- Packages are unsigned. The SDK's `signtool.exe` needs the x64 MFC runtime,
  which Wine lacks, so a build that enables signing fails with an explicit
  error. Sign on Windows.
- MSXML accepts AppX manifest schema constructs that libxml2 rejects. The last
  patch normalizes QName whitespace and redeclared inherited attributes, and
  drops pattern facets written in MSXML's own regular expression dialect, so
  `makeappx` does not enforce those string patterns here.
- The build reports warning APPX2101 for `makepri.exe`: .NET on Linux cannot
  read version resources from native executables, so the manifest's build
  metadata omits the MakePri version.
- The `winui` image needs a linux/amd64 host. Building it runs 32-bit Wine
  code, which Docker's Rosetta emulation on Apple silicon cannot execute.

## Development

`bun run test` checks that the image's Rust, .NET, and Wine pins agree with the
repository. The `selftest-base` and `selftest-winui` Dockerfile targets build
every sample under `samples/` and check the output with `test/selftest-*.sh`:

```bash
docker buildx build -f packages/windows-cross-compiler/Dockerfile --target selftest-winui .
```

CI builds the self-tests on pull requests and publishes both images from
`main`, then opens a pull request that updates `images/*/DIGEST`.
