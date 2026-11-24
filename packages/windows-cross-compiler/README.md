# windows-cross-compiler

Linux container images that build Windows software: C, C++, Rust, and .NET
for x64 and ARM64 Windows, and Windows App SDK (WinUI 3) apps packaged as MSIX.
Nothing runs on Windows and nothing is signed.

| Image                                                   | Contents                                                                                                     | Hosts                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `docker.io/shepherdjerred/windows-cross-compiler`       | clang-cl and lld with the MSVC CRT and Windows SDK, Rust with cargo-xwin, the .NET SDK, NSIS                 | linux/amd64 (the Dockerfile also builds on linux/arm64) |
| `docker.io/shepherdjerred/windows-cross-compiler-winui` | The above plus Wine 11.0 and .NET Framework 4.8 running Microsoft's XAML compiler, `makepri`, and `makeappx` | linux/amd64                                             |

Images are published by digest only. Use the digest recorded in
`images/<image>/DIGEST`:

```bash
image="docker.io/shepherdjerred/windows-cross-compiler@$(cat images/windows-cross-compiler/DIGEST)"
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

Self-contained unpackaged apps publish the same way:

```bash
dotnet publish -c Release -r win-x64 -p:Platform=x64 -p:SelfContained=true \
  -p:WindowsPackageType=None -p:WindowsAppSDKSelfContained=true \
  -p:EnableMsixTooling=false -o /workspace/standalone/
```

The targets run the stock .NET Framework `XamlCompiler.exe` (which also
compiles XAML to XBF) and the Windows SDK's `makepri`, `makeappx`, and `mt.exe`
under Wine through generated shims. `mt.exe` receives absolute paths as Wine
`Z:` paths, because it reads a leading `/` as an option. Because the MSBuild
process is .NET on Linux, packaged resources are mapped from `makepri dump`
output instead of loading `MrmSupport.dll`, the path the MSIX tooling already
takes where the resource indexer API is unavailable. A PRI names its files
case-insensitively, so the files an unpackaged build copies out of a
referenced PRI are resolved against the case-sensitive file system.

Wine 11.0 needs these patches (`wine-patches/`) for those tools:

| Patch                                                                              | Tool that needs it                |
| ---------------------------------------------------------------------------------- | --------------------------------- |
| `shcore` forwards ordinal 170 (`PathIsNetworkPathW`)                               | `makepri`                         |
| `msxml3` validates documents built through the DOM                                 | `makepri`                         |
| `msxml3` `MXXMLWriter` accepts a document locator                                  | `makepri dump`                    |
| `ntdll` AVL generic tables                                                         | `makeappx` and its packaging DLLs |
| `msxml3` SAX attribute types and XML declaration properties                        | `makeappx`                        |
| `msxml3` schema collections compile across namespaces when `validateOnLoad` is off | `makeappx` manifest validation    |
| `msxml3` `MXXMLWriter` does not indent an end tag that follows text                | `makepri dump`                    |

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
  code, which Docker's Rosetta emulation on Apple silicon cannot execute, and
  running its XAML compiler under emulation there aborts in Wine
  (`anon_mmap_fixed: Assertion ... host_page_mask`). On Apple silicon, run
  WinUI builds on a linux/amd64 host, such as the cluster's BuildKit through
  the port-forward below.

## Development

`bun run test` checks that the image's Rust, .NET, and Wine pins agree with the
repository. The `selftest-base` and `selftest-winui` Dockerfile targets build
every sample under `samples/` and check the output with `test/selftest-*.sh`:

```bash
docker buildx build -f packages/windows-cross-compiler/Dockerfile --target selftest-winui .
```

Compiler image self-tests and image refreshes are paused in CI. The Dockerfile
targets above remain available for local validation, and existing
`images/*/DIGEST` pins remain unchanged until an explicit image release.

### Releasing an image by hand

Rebuild both images whenever the Dockerfile's pins change (for example
`DOTNET_SDK_VERSION` after `global.json` moves): `winui` builds from `base`.
Build on the cluster's BuildKit, which is linux/amd64, through a port-forward.
BuildKit pushes with the client's Docker credentials, which must have push
scope: use the `ci-dockerhub-publisher-credentials` item from the homelab
vault (`DOCKERHUB_USERNAME`, `DOCKERHUB_PUBLISH_TOKEN`) through
`scripts/onepassword/with-service-account.sh op run`, served by a credential
helper or a throwaway `DOCKER_CONFIG`. A read-only Docker Hub token fails the
push with `401 Unauthorized: access token has insufficient scopes`.
`CI_RELEASE_NUMBER` must exceed the pinned `buildNumber`; use the main pipeline
number of the source commit.

```bash
kubectl -n buildkitd port-forward svc/buildkitd-buildkitd-service 21234:1234 &
docker buildx create --name ci --driver remote tcp://127.0.0.1:21234
export CI_COMMIT_SHA=$(git rev-parse HEAD) CI_RELEASE_NUMBER=<main pipeline number>
for image in windows-cross-compiler windows-cross-compiler-winui; do
  bun ci/scripts/images/build-ci-image.ts --image "$image" --candidate-out "/tmp/$image.json"
done
bun ci/scripts/images/selftest-ci-image.ts
docker buildx rm ci
kill %1
```

Each candidate file holds the `images/<image>/STATE.json` fields (with
`schema` set to `ci-image-pin-state/v1`) and the digest for `DIGEST`. Update
both files, and the digests on `packages/cross-compilers-site`, in one PR.
