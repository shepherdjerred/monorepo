import {
  func,
  argument,
  Directory,
  object,
  Secret,
  Container,
  dag,
} from "@dagger.io/dagger";
import {
  logWithTimestamp,
  withTiming,
  formatDaggerError,
  getSystemContainer,
  publishToGhcrMultiple,
} from "@shepherdjerred/dagger-utils";

@object()
export class MacosCrossCompiler {
  /**
   * Build and push the macOS cross-compiler image
   * @param source The source directory
   * @param architectures Target architectures (comma-separated)
   * @param sdkVersion macOS SDK version
   * @param kernelVersion Darwin kernel version
   * @param targetSdkVersion Target SDK version for deployment
   * @param downloadSdk Whether to download SDK or use local copy
   * @param cores Number of CPU cores to use for compilation
   * @param ghcrUsername GitHub Container Registry username
   * @param ghcrPassword GitHub Container Registry password
   * @returns Success message
   */
  @func()
  async ci(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
        "out",
        "dagger_examples",
      ],
      defaultPath: ".",
    })
    source: Directory,
    architectures: string = "aarch64,x86_64",
    sdkVersion: string = "15.0",
    kernelVersion: string = "24",
    targetSdkVersion: string = "11.0.0",
    downloadSdk: boolean = true,
    cores: number = 16,
    ghcrUsername?: string,
    ghcrPassword?: Secret
  ): Promise<string> {
    logWithTimestamp("🚀 Starting macOS cross-compiler CI pipeline");

    const archList = architectures.split(",").map(arch => arch.trim());

    // Build the cross-compiler image
    const image = await withTiming("cross-compiler image build", async () => {
      return await this.buildImage(
        source,
        architectures,
        sdkVersion,
        kernelVersion,
        targetSdkVersion,
        downloadSdk,
        cores
      );
    });

    // Run tests
    await withTiming("tests", async () => {
      await this.test(
        source,
        architectures,
        sdkVersion,
        kernelVersion,
        targetSdkVersion,
        downloadSdk,
        cores
      );
    });

    // Push image if credentials provided
    if (ghcrUsername && ghcrPassword) {
      await withTiming("image push", async () => {
        await this.pushImage(image, sdkVersion, ghcrUsername, ghcrPassword);
      });
    }

    return "✅ macOS cross-compiler CI pipeline completed successfully";
  }

    /**
   * Build the macOS cross-compiler image
   * @param source The source directory
   * @param architectures Target architectures
   * @param sdkVersion macOS SDK version
   * @param kernelVersion Darwin kernel version
   * @param targetSdkVersion Target SDK version
   * @param downloadSdk Whether to download SDK
   * @param cores Number of CPU cores
   * @returns Built container image
   */
  @func()
  async buildImage(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
        "out",
        "dagger_examples",
      ],
      defaultPath: ".",
    })
    source: Directory,
    architectures: string = "aarch64,x86_64",
    sdkVersion: string = "15.0",
    kernelVersion: string = "24",
    targetSdkVersion: string = "11.0.0",
    downloadSdk: boolean = true,
    cores: number = 16
  ): Promise<Container> {
    logWithTimestamp("🏗️ Building macOS cross-compiler image");

    // Start with base Ubuntu container
    let container = dag.container()
      .from("ubuntu:noble")
      .withWorkdir("/workspace");

    // Install base dependencies
    container = await this.installBaseDeps(container);

    // Build components in dependency order
    const xar = await this.buildXar(container, targetSdkVersion, cores);
    const libdispatch = await this.buildLibdispatch(container, targetSdkVersion, cores);
    const libtapi = await this.buildLibtapi(container, targetSdkVersion, cores);

    // Get or download SDK
    const sdk = await this.getSdk(container, sdkVersion, downloadSdk);

    // Build Zig compiler
    const zig = await this.buildZig(container);

    // Set up SDK in container
    container = container
      .withDirectory("/osxcross/SDK/MacOSX" + sdkVersion + ".sdk", sdk)
      .withExec(["ln", "-s", "/osxcross/SDK/MacOSX" + sdkVersion + ".sdk/", "/sdk"])
      .withExec(["apt", "update"])
      .withExec(["apt", "install", "-y", "clang", "file", "libmpc-dev", "libmpfr-dev", "curl"])
      .withExec(["bash", "-c", "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"])
      .withEnvVariable("PATH", "/root/.cargo/bin:/usr/local/bin:/gcc/bin:/cctools/bin:/osxcross/bin:$PATH", { expand: true })
      .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
      .withDirectory("/usr/local/bin", zig);

    // Build for each architecture
    const archList = architectures.split(",").map(arch => arch.trim());

    for (const architecture of archList) {
      const triple = `${architecture}-apple-darwin${kernelVersion}`;

      // Build cctools for this architecture
      const cctools = await this.buildCctools(
        container,
        architecture,
        kernelVersion,
        targetSdkVersion,
        cores,
        xar,
        libtapi,
        libdispatch
      );

      // Build wrappers
      const clangWrappers = await this.buildClangWrappers(
        container,
        sdkVersion,
        kernelVersion,
        targetSdkVersion,
        cores
      );

      const gccWrappers = await this.buildGccWrappers(
        container,
        sdkVersion,
        kernelVersion,
        targetSdkVersion,
        cores
      );

      // Build GCC for this architecture
      const gcc = await this.buildGcc(
        container,
        architecture,
        sdkVersion,
        kernelVersion,
        targetSdkVersion,
        downloadSdk,
        cores,
        clangWrappers,
        cctools,
        sdk,
        xar,
        libtapi,
        libdispatch
      );

      // Add binaries to final container
      container = container
        .withDirectory("/cctools", cctools)
        .withDirectory("/osxcross", clangWrappers)
        .withDirectory("/osxcross", gccWrappers)
        .withDirectory("/gcc", gcc)
        .withFile("/usr/local/bin/zig-cc-" + architecture + "-macos", source.file("zig/zig-cc-" + architecture + "-macos"))
        .withExec(["chmod", "+x", "/usr/local/bin/zig-cc-" + architecture + "-macos"]);

      // Install Rust targets
      container = container
        .withExec(["rustup", "target", "add", architecture + "-apple-darwin"]);
    }

    // Final library setup - use cp to merge directories instead of withDirectory which replaces
    container = container
      .withDirectory("/tmp/xar-lib", xar.directory("lib"))
      .withDirectory("/tmp/libtapi-lib", libtapi.directory("lib"))
      .withDirectory("/tmp/libdispatch-lib", libdispatch.directory("lib"))
      .withExec(["bash", "-c", "cp -r /tmp/xar-lib/* /usr/local/lib/ || true"])
      .withExec(["bash", "-c", "cp -r /tmp/libtapi-lib/* /usr/local/lib/ || true"])
      .withExec(["bash", "-c", "cp -r /tmp/libdispatch-lib/* /usr/local/lib/ || true"])
      .withExec(["ldconfig"])
      .withWorkdir("/workspace");

    return container;
  }

  /**
   * Install base dependencies
   * Uses getSystemContainer for apt caching optimization
   */
  private async installBaseDeps(_container: Container): Promise<Container> {
    return getSystemContainer()
      .withExec(["apt-get", "install", "-y", "build-essential", "cmake", "clang", "git"]);
  }

  /**
   * Build xar library
   */
  private async buildXar(container: Container, targetSdkVersion: string, cores: number): Promise<Directory> {
    const xarCommit = "5fa4675419cfec60ac19a9c7f7c2d0e7c831a497";
    const xarContainer = container
      .withExec(["apt", "install", "-y", "libxml2-dev", "libssl-dev", "zlib1g-dev", "autoconf", "automake", "libtool"])
      .withExec(["git", "clone", "https://github.com/tpoechtrager/xar", "/tmp/xar-repo"])
      .withWorkdir("/tmp/xar-repo")
      .withExec(["git", "checkout", xarCommit])
      .withWorkdir("/tmp/xar-repo/xar")
      .withExec(["./autogen.sh", "--noconfigure"])
      .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
      .withExec(["./configure", "--prefix=/xar"])
      .withExec(["make", "-j" + cores.toString()])
      .withExec(["make", "install"]);

    return xarContainer.directory("/xar");
  }

  /**
   * Build libdispatch library
   */
  private async buildLibdispatch(container: Container, targetSdkVersion: string, cores: number): Promise<Directory> {
    const commit = "fdf3fc85a9557635668c78801d79f10161d83f12";
    const libdispatchContainer = container
      .withExec(["apt", "install", "-y", "clang"])
      .withExec(["git", "clone", "https://github.com/tpoechtrager/apple-libdispatch", "/tmp/libdispatch-src"])
      .withWorkdir("/tmp/libdispatch-src")
      .withExec(["git", "checkout", commit])
      .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
      .withEnvVariable("TARGETDIR", "/libdispatch")
      .withEnvVariable("CC", "clang")
      .withEnvVariable("CXX", "clang++")
      .withExec(["mkdir", "-p", "build"])
      .withWorkdir("build")
      .withExec(["cmake", "..", "-DCMAKE_BUILD_TYPE=RELEASE", "-DCMAKE_INSTALL_PREFIX=/libdispatch", "-DCMAKE_C_COMPILER=clang", "-DCMAKE_CXX_COMPILER=clang++"])
      .withExec(["make", "install", "-j" + cores.toString()]);

    return libdispatchContainer.directory("/libdispatch");
  }

  /**
   * Build libtapi library
   */
  private async buildLibtapi(container: Container, targetSdkVersion: string, cores: number): Promise<Directory> {
    const version = "1300.6.5";
    const libtapiContainer = container
      .withExec(["apt", "install", "-y", "python3"])
      .withExec(["git", "clone", "--branch", version, "https://github.com/tpoechtrager/apple-libtapi", "/tmp/libtapi-src"])
      .withWorkdir("/tmp/libtapi-src")
      .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
      .withEnvVariable("INSTALLPREFIX", "/libtapi")
      .withExec(["./build.sh"])
      .withExec(["./install.sh"]);

    return libtapiContainer.directory("/libtapi");
  }

  /**
   * Build cctools
   */
  private async buildCctools(
    container: Container,
    architecture: string,
    kernelVersion: string,
    targetSdkVersion: string,
    cores: number,
    xar: Directory,
    libtapi: Directory,
    libdispatch: Directory
  ): Promise<Directory> {
    // autoconf does not recognize aarch64 -- use arm instead
    const triple = architecture === "aarch64" ?
      `arm-apple-darwin${kernelVersion}` :
      `${architecture}-apple-darwin${kernelVersion}`;

    const cctoolsVersion = "1010.6";
    const linkerVersion = "951.9";

    const cctoolsContainer = container
      .withExec(["apt", "install", "-y", "llvm-dev", "uuid-dev", "rename", "zlib1g-dev", "libssl-dev"])
      .withExec(["git", "clone", "--branch", `${cctoolsVersion}-ld64-${linkerVersion}`, "https://github.com/tpoechtrager/cctools-port", "/tmp/cctools-src"])
      .withWorkdir("/tmp/cctools-src")
      .withDirectory("/xar", xar)
      .withDirectory("/libtapi", libtapi)
      .withDirectory("/libdispatch", libdispatch)
      .withWorkdir("/tmp/cctools-src/cctools")
      .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
      .withExec([
        "./configure",
        "--prefix=/cctools",
        "--with-libtapi=/libtapi",
        "--with-libxar=/xar",
        "--with-libdispatch=/libdispatch",
        "--with-libblocksruntime=/libdispatch",
        "--target=" + triple
      ]);

    // Fix aarch64 target naming - must capture result due to Dagger immutability
    let buildContainer = cctoolsContainer;
    if (architecture === "aarch64") {
      buildContainer = buildContainer
        .withExec(["bash", "-c", `find . -name Makefile -print0 | xargs -0 sed -i 's/arm-apple-darwin${kernelVersion}/arm64-apple-darwin${kernelVersion}/g'`]);
    }

    let finalContainer = buildContainer
      .withExec(["make", "-j" + cores.toString()])
      .withExec(["make", "install"]);

    // Link aarch64 artifacts - must capture result due to Dagger immutability
    if (architecture === "aarch64") {
      finalContainer = finalContainer
        .withExec(["bash", "-c", "cd /cctools/bin && for file in *arm64*; do ln -s $file ${file/arm64/aarch64}; done"]);
    }

    return finalContainer.directory("/cctools");
  }

  /**
   * Build wrapper for clang
   */
  private async buildClangWrappers(
    container: Container,
    sdkVersion: string,
    kernelVersion: string,
    targetSdkVersion: string,
    cores: number
  ): Promise<Directory> {
    const osxcrossCommit = "29fe6dd35522073c9df5800f8cd1feb4b9a993a8";
    const wrapperContainer = container
      .withExec(["git", "clone", "https://github.com/tpoechtrager/osxcross", "/tmp/osxcross-src"])
      .withWorkdir("/tmp/osxcross-src")
      .withExec(["git", "checkout", osxcrossCommit])
      .withWorkdir("/tmp/osxcross-src/wrapper")
      .withEnvVariable("VERSION", "1.5")
      .withEnvVariable("SDK_VERSION", sdkVersion)
      .withEnvVariable("TARGET", "darwin" + kernelVersion)
      .withEnvVariable("LINKER_VERSION", "951.9")
      .withEnvVariable("X86_64H_SUPPORTED", "0")
      .withEnvVariable("I386_SUPPORTED", "0")
      .withEnvVariable("ARM_SUPPORTED", "1")
      .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
      .withExec(["make", "wrapper", "-j" + cores.toString()]);

    const compilers = ["clang", "clang++"];
    let finalContainer = wrapperContainer
      .withEnvVariable("TARGET_DIR", "/osxcross");

    for (const compiler of compilers) {
      finalContainer = finalContainer
        .withEnvVariable("TARGETCOMPILER", compiler)
        .withExec(["./build_wrapper.sh"]);
    }

    return finalContainer.directory("/osxcross");
  }

  /**
   * Build wrapper for GCC
   */
  private async buildGccWrappers(
    container: Container,
    sdkVersion: string,
    kernelVersion: string,
    targetSdkVersion: string,
    cores: number
  ): Promise<Directory> {
    const osxcrossCommit = "29fe6dd35522073c9df5800f8cd1feb4b9a993a8";
    const wrapperContainer = container
      .withExec(["git", "clone", "https://github.com/tpoechtrager/osxcross", "/tmp/osxcross-gcc-src"])
      .withWorkdir("/tmp/osxcross-gcc-src")
      .withExec(["git", "checkout", osxcrossCommit])
      .withWorkdir("/tmp/osxcross-gcc-src/wrapper")
      .withEnvVariable("VERSION", "1.5")
      .withEnvVariable("SDK_VERSION", sdkVersion)
      .withEnvVariable("TARGET", "darwin" + kernelVersion)
      .withEnvVariable("LINKER_VERSION", "951.9")
      .withEnvVariable("X86_64H_SUPPORTED", "0")
      .withEnvVariable("I386_SUPPORTED", "0")
      .withEnvVariable("ARM_SUPPORTED", "1")
      .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
      .withExec(["make", "wrapper", "-j" + cores.toString()]);

    const compilers = ["gcc", "g++", "gfortran"];
    let finalContainer = wrapperContainer
      .withEnvVariable("TARGET_DIR", "/osxcross");

    for (const compiler of compilers) {
      finalContainer = finalContainer
        .withEnvVariable("TARGETCOMPILER", compiler)
        .withExec(["./build_wrapper.sh"]);
    }

    return finalContainer.directory("/osxcross");
  }

  /**
   * Get or download SDK
   */
  private async getSdk(container: Container, version: string, downloadSdk: boolean): Promise<Directory> {
    if (downloadSdk) {
      const sdkContainer = container
        .withExec(["apt", "update"])
        .withExec(["apt", "install", "-y", "wget"])
        .withExec(["wget", `https://github.com/joseluisq/macosx-sdks/releases/download/${version}/MacOSX${version}.sdk.tar.xz`])
        .withExec(["tar", "-xf", `MacOSX${version}.sdk.tar.xz`])
        .withExec(["bash", "-c", `mv MacOSX*.sdk MacOSX${version}.sdk || true`]);

      return sdkContainer.directory(`MacOSX${version}.sdk`);
    } else {
      const sdkContainer = container
        .withFile(`MacOSX${version}.sdk.tar.xz`, dag.host().directory("sdks").file(`MacOSX${version}.sdk.tar.xz`))
        .withExec(["tar", "-xf", `MacOSX${version}.sdk.tar.xz`]);

      return sdkContainer.directory(`MacOSX${version}.sdk`);
    }
  }

  /**
   * Build Zig compiler
   */
  private async buildZig(container: Container, targetArch: string = "x86_64"): Promise<Directory> {
    const zigVersion = "0.13.0";

    // Determine the correct Zig archive based on target architecture
    let archSuffix: string;
    if (targetArch === "aarch64" || targetArch === "arm64") {
      archSuffix = "aarch64";
    } else if (targetArch === "x86_64" || targetArch === "amd64") {
      archSuffix = "x86_64";
    } else {
      throw new Error(`Unsupported architecture: ${targetArch}`);
    }

    const zigContainer = container
      .withExec(["apt", "install", "-y", "wget", "xz-utils"])
      .withExec(["wget", "-O", "zig.tar.xz", `https://ziglang.org/download/${zigVersion}/zig-linux-${archSuffix}-${zigVersion}.tar.xz`])
      .withExec(["tar", "-xf", "zig.tar.xz"])
      .withExec(["rm", "zig.tar.xz"])
      .withExec(["bash", "-c", "mv zig* zig"]);

    return zigContainer.directory("zig");
  }

  /**
   * Build GCC compiler
   */
  private async buildGcc(
    container: Container,
    architecture: string,
    sdkVersion: string,
    kernelVersion: string,
    targetSdkVersion: string,
    downloadSdk: boolean,
    cores: number,
    clangWrappers: Directory,
    cctools: Directory,
    sdk: Directory,
    xar: Directory,
    libtapi: Directory,
    libdispatch: Directory
  ): Promise<Directory> {
    const triple = `${architecture}-apple-darwin${kernelVersion}`;

    const gccContainer = container
      .withExec(["apt", "install", "-y", "gcc", "g++", "zlib1g-dev", "libmpc-dev", "libmpfr-dev", "libgmp-dev", "flex", "file"])
      .withExec(["apt-get", "install", "-y", "--force-yes", "llvm-dev", "libxml2-dev", "uuid-dev", "libssl-dev", "bash", "patch", "make", "tar", "xz-utils", "bzip2", "gzip", "sed", "cpio", "libbz2-dev", "zlib1g-dev"])
      .withExec(["git", "clone", "--branch=gcc-14-2-darwin", "https://github.com/iains/gcc-14-branch", "/tmp/gcc-src"])
      .withDirectory("/osxcross", clangWrappers)
      .withDirectory("/cctools", cctools)
      .withDirectory("/sdk", sdk)
      // Mount each library to a temp location then copy to merge into /sdk/usr
      .withDirectory("/tmp/xar", xar)
      .withDirectory("/tmp/libtapi", libtapi)
      .withDirectory("/tmp/libdispatch", libdispatch)
      .withExec(["bash", "-c", "cp -r /tmp/xar/* /sdk/usr/ || true"])
      .withExec(["bash", "-c", "cp -r /tmp/libtapi/* /sdk/usr/ || true"])
      .withExec(["bash", "-c", "cp -r /tmp/libdispatch/* /sdk/usr/ || true"])
      // Copy libraries to /usr/local/lib for runtime linking
      .withExec(["bash", "-c", "cp -r /tmp/xar/lib/* /usr/local/lib/ || true"])
      .withExec(["bash", "-c", "cp -r /tmp/libtapi/lib/* /usr/local/lib/ || true"])
      .withExec(["bash", "-c", "cp -r /tmp/libdispatch/lib/* /usr/local/lib/ || true"])
      .withExec(["ldconfig"])
      .withExec(["mkdir", "-p", "/osxcross/SDK"])
      .withExec(["ln", "-s", "/sdk", `/osxcross/SDK/MacOSX${sdkVersion}.sdk`])
      .withEnvVariable("PATH", "$PATH:/osxcross/bin:/cctools/bin", { expand: true })
      .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
      .withExec(["mkdir", "-p", "/tmp/gcc-build"])
      .withWorkdir("/tmp/gcc-build")
      .withExec([
        "/tmp/gcc-src/configure",
        "--target=" + triple,
        "--with-sysroot=/sdk",
        "--disable-nls",
        "--enable-languages=c,c++,fortran,objc,obj-c++",
        "--without-headers",
        "--enable-lto",
        "--enable-checking=release",
        "--disable-libstdcxx-pch",
        "--prefix=/gcc",
        "--with-system-zlib",
        "--disable-multilib",
        "--with-ld=/cctools/bin/" + triple + "-ld",
        "--with-as=/cctools/bin/" + triple + "-as"
      ])
      .withExec(["make", "-j" + cores.toString()])
      .withExec(["make", "install"]);

    return gccContainer.directory("/gcc");
  }

  /**
   * Test the cross-compiler
   */
  @func()
  async test(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
        "out",
        "dagger_examples",
      ],
      defaultPath: ".",
    })
    source: Directory,
    architectures: string = "aarch64,x86_64",
    sdkVersion: string = "15.0",
    kernelVersion: string = "24",
    targetSdkVersion: string = "11.0.0",
    downloadSdk: boolean = true,
    cores: number = 16
  ): Promise<string> {
    logWithTimestamp("🧪 Testing cross-compiler");

    const image = await this.buildImage(
      source,
      architectures,
      sdkVersion,
      kernelVersion,
      targetSdkVersion,
      downloadSdk,
      cores
    );

    const testContainer = image
      .withDirectory("samples", source.directory("samples"))
      .withExec(["mkdir", "-p", "out"]);

    const archList = architectures.split(",").map(arch => arch.trim());

    for (const architecture of archList) {
      const triple = `${architecture}-apple-darwin${kernelVersion}`;

      let archContainer = testContainer
        .withEnvVariable("triple", triple)
        .withExec([triple + "-clang", "--target=" + triple, "samples/hello.c", "-o", "out/hello-clang"])
        .withExec([triple + "-clang++", "--target=" + triple, "samples/hello.cpp", "-o", "out/hello-clang++"])
        .withExec([triple + "-gcc", "samples/hello.c", "-o", "out/hello-gcc"])
        .withExec([triple + "-g++", "samples/hello.cpp", "-o", "out/hello-g++"])
        .withExec([triple + "-gfortran", "samples/hello.f90", "-o", "out/hello-gfortran"])
        .withExec([
          "zig", "cc",
          "-target", `${architecture}-macos`,
          "--sysroot=/sdk",
          "-I/sdk/usr/include",
          "-L/sdk/usr/lib",
          "-F/sdk/System/Library/Frameworks",
          "-framework", "CoreFoundation",
          "-o", "out/hello-zig-c", "samples/hello.c"
        ])
        .withEnvVariable("CC", `zig-cc-${architecture}-macos`)
        .withWorkdir("samples/rust")
        .withExec(["cargo", "build", "--target", `${architecture}-apple-darwin`])
        .withExec(["mv", `target/${architecture}-apple-darwin/debug/hello`, "../../out/hello-rust"])
        .withWorkdir("/workspace");

      // Verify architecture
      const expectedArch = architecture === "aarch64" ? "arm64" : architecture;
      const archPattern = architecture === "aarch64" ? "Mach-O 64-bit arm64 executable" : `Mach-O 64-bit ${architecture} executable`;

      archContainer = archContainer
        .withExec(["file", "out/hello-clang"])
        .withExec(["bash", "-c", `file out/hello-clang | grep -q "${archPattern}"`])
        .withExec(["bash", "-c", `file out/hello-clang++ | grep -q "${archPattern}"`])
        .withExec(["bash", "-c", `file out/hello-gcc | grep -q "${archPattern}"`])
        .withExec(["bash", "-c", `file out/hello-g++ | grep -q "${archPattern}"`])
        .withExec(["bash", "-c", `file out/hello-gfortran | grep -q "${archPattern}"`])
        .withExec(["bash", "-c", `file out/hello-zig-c | grep -q "${archPattern}"`])
        .withExec(["bash", "-c", `file out/hello-rust | grep -q "${archPattern}"`]);

      // Export artifacts
      await archContainer.directory("out").export(`./out/${architecture}`);
    }

    return "✅ Cross-compiler tests passed for all architectures";
  }

  /**
   * Push the image to registry
   * Uses publishToGhcrMultiple for parallel tag publishing
   */
  private async pushImage(
    image: Container,
    sdkVersion: string,
    username: string,
    password: Secret
  ): Promise<string> {
    logWithTimestamp("📤 Pushing image to registry");

    const registry = "ghcr.io/shepherdjerred/macos-cross-compiler";

    // Push with both latest and version tags in parallel
    const refs = await publishToGhcrMultiple({
      container: image,
      imageRefs: [
        `${registry}:latest`,
        `${registry}:${sdkVersion}`,
      ],
      username,
      password,
    });

    return `✅ Image pushed to ${refs.join(" and ")}`;
  }

  /**
   * Validate the cross-compiler by running executables (macOS only)
   */
  @func()
  async validate(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
        "out",
        "dagger_examples",
      ],
      defaultPath: ".",
    })
    source: Directory,
    userArch: string = "aarch64"
  ): Promise<string> {
    logWithTimestamp("✅ Validating cross-compiled executables");

    // Convert architecture names
    let arch = userArch;
    if (arch === "arm64") {
      arch = "aarch64";
    } else if (arch === "x86_64") {
      arch = "amd64";
    }

    // First run the test to generate binaries
    await this.test(source);

    // Run the executables on the host (requires macOS)
    const validationContainer = dag.container()
      .from("busybox")
      .withDirectory("/out", dag.host().directory(`out/${arch}`))
      .withExec(["./out/hello-clang"])
      .withExec(["./out/hello-clang++"])
      .withExec(["./out/hello-g++"])
      .withExec(["./out/hello-gcc"])
      .withExec(["./out/hello-gfortran"])
      .withExec(["./out/hello-zig-c"])
      .withExec(["./out/hello-rust"]);

    await validationContainer.sync();

    return "✅ All cross-compiled executables validated successfully";
  }
}
