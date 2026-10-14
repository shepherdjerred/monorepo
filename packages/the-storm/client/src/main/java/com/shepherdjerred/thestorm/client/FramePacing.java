package com.shepherdjerred.thestorm.client;

import com.mojang.blaze3d.systems.RenderSystem;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.minecraft.client.Minecraft;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;

/**
 * Passive per-render timing. Receipt I/O starts only after the bounded observation window closes.
 */
final class FramePacing implements AutoCloseable {
  static final List<String> CODE_RESOURCES =
      List.of(
          "FramePacing.class",
          "FramePacing$Settings.class",
          "FramePacing$RendererRuntime.class",
          "FramePacing$Code.class",
          "FramePacing$Run.class",
          "FramePacing$Receipt.class",
          "FramePacing$Status.class",
          "FramePacingClock.class",
          "FramePacingClock$Observation.class",
          "FramePacingClock$Camera.class",
          "FramePacingClock$RenderObservation.class",
          "FramePacingClock$Quantiles.class",
          "RenderCapture.class",
          "ClientActions.class",
          "mixin/FrameRenderMixin.class",
          "/storm-frame-pacing.json");

  record Settings(
      int width,
      int height,
      int windowWidth,
      int windowHeight,
      int fpsCap,
      boolean vsync,
      int renderDistance,
      int effectiveRenderDistance,
      int simulationDistance,
      String graphicsPreset,
      boolean fullscreen,
      int fov) {
    static Settings read(Minecraft client) {
      var options = client.options;
      var window = client.getWindow();
      return new Settings(
          client.gameRenderer.mainRenderTarget().width,
          client.gameRenderer.mainRenderTarget().height,
          window.getScreenWidth(),
          window.getScreenHeight(),
          options.framerateLimit().get(),
          options.enableVsync().get(),
          options.renderDistance().get(),
          options.getEffectiveRenderDistance(),
          options.simulationDistance().get(),
          options.graphicsPreset().get().getSerializedName(),
          window.isFullscreen(),
          options.fov().get());
    }
  }

  record Code(String file, String sha256) {}

  record RendererRuntime(
      String javaVersion,
      String javaVendor,
      String osName,
      String osVersion,
      String osArch,
      String minecraftVersion,
      String gpuName,
      String gpuVendor,
      String gpuDriver,
      String gpuBackend,
      List<Code> code) {
    static RendererRuntime read(Minecraft client) {
      var device = RenderSystem.getDevice().getDeviceInfo();
      var hashes = new ArrayList<Code>();
      for (var resource : CODE_RESOURCES) {
        try (var stream =
            java.util.Objects.requireNonNull(FramePacing.class.getResourceAsStream(resource))) {
          hashes.add(
              new Code(
                  resource,
                  HexFormat.of()
                      .formatHex(
                          MessageDigest.getInstance("SHA-256").digest(stream.readAllBytes()))));
        } catch (IOException | NoSuchAlgorithmException failure) {
          throw new IllegalStateException("Cannot fingerprint frame pacing producer", failure);
        }
      }
      return new RendererRuntime(
          System.getProperty("java.version"),
          System.getProperty("java.vendor"),
          System.getProperty("os.name"),
          System.getProperty("os.version"),
          System.getProperty("os.arch"),
          client.getLaunchedVersion(),
          device.name(),
          device.vendorName(),
          device.driverInfo(),
          device.backendName(),
          List.copyOf(hashes));
    }
  }

  record Receipt(
      int schema,
      String kind,
      String source,
      boolean complete,
      String error,
      String name,
      String world,
      int requestedDurationMs,
      int requestedFrames,
      String completion,
      long observedElapsedNanos,
      long measuredDurationNanos,
      long tailNanos,
      Settings settings,
      RendererRuntime runtime,
      List<FramePacingClock.Observation> observations,
      FramePacingClock.@Nullable Quantiles quantiles) {}

  record Status(String name, String state, int frames, String error, String receipt) {}

  private static final class Run {
    final String name;
    final int durationMs;
    final int targetFrames;
    final Path file;
    final String world;
    final Settings settings;
    final RendererRuntime runtime;
    net.minecraft.client.multiplayer.@Nullable ClientLevel level;
    final FramePacingClock clock;
    volatile String state = "RUNNING";
    volatile String error = "";

    Run(Minecraft client, Path artifacts, JsonNode arguments) {
      Protocol.keys(arguments, Set.of("name", "durationMs", "targetFrames"));
      name = Protocol.text(arguments, "name", 64);
      if (!name.matches("[a-z0-9][a-z0-9-]{0,63}"))
        throw new IllegalArgumentException("Invalid frame pacing name");
      durationMs = Protocol.integer(arguments, "durationMs", 1, FramePacingClock.MAX_DURATION_MS);
      targetFrames = Protocol.integer(arguments, "targetFrames", 2, FramePacingClock.MAX_FRAMES);
      file = artifacts.resolve(name + "-frame-pacing.json");
      if (Files.exists(file))
        throw new IllegalArgumentException("Frame pacing receipt already exists");
      settings = Settings.read(client);
      runtime = RendererRuntime.read(client);
      level = java.util.Objects.requireNonNull(client.level);
      world = level.dimension().identifier().toString();
      clock = new FramePacingClock(System.nanoTime(), durationMs, targetFrames);
    }
  }

  private final Path artifacts;
  private final ExecutorService io =
      Executors.newSingleThreadExecutor(
          Thread.ofVirtual().name("storm-frame-pacing-receipt").factory());
  private @Nullable Run run;

  FramePacing(Path artifacts) {
    this.artifacts = artifacts;
  }

  boolean active() {
    return run != null && run.state.equals("RUNNING");
  }

  Status start(Minecraft client, JsonNode arguments) {
    if (run != null && (run.state.equals("RUNNING") || run.state.equals("WRITING")))
      throw new IllegalStateException("Frame pacing measurement is already active");
    run = new Run(client, artifacts, arguments);
    return status();
  }

  Status status() {
    var current = run;
    return current == null
        ? new Status("", "IDLE", 0, "", "")
        : new Status(
            current.name,
            current.state,
            current.clock.frames(),
            current.error,
            current.file.toString());
  }

  void rendered(Minecraft client) {
    var current = run;
    if (current == null || !active()) return;
    try {
      validate(client, current);
      current.clock.rendered(
          System.nanoTime(),
          new FramePacingClock.RenderObservation(
              java.util.Objects.requireNonNull(client.level).getGameTime(),
              client.isWindowActive(),
              client.gui.screen() != null,
              client.getFramerateLimitTracker().getFramerateLimit(),
              camera(client)));
      if (current.clock.complete()) finish(current, "");
    } catch (RuntimeException failure) {
      finish(current, failure.toString());
    }
  }

  void tick(Minecraft client) {
    var current = run;
    if (current == null || !active()) return;
    try {
      validate(client, current);
      current.clock.tick(System.nanoTime());
      if (current.clock.complete()) finish(current, "");
    } catch (RuntimeException failure) {
      finish(current, failure.toString());
    }
  }

  private static void validate(Minecraft client, Run current) {
    if (client.player == null || !java.util.Objects.equals(client.level, current.level))
      throw new IllegalStateException("Frame pacing world disconnected or changed");
    if (!Settings.read(client).equals(current.settings))
      throw new IllegalStateException("Frame pacing render settings changed during measurement");
  }

  private static FramePacingClock.Camera camera(Minecraft client) {
    var camera = client.gameRenderer.mainCamera();
    var position = camera.position();
    return new FramePacingClock.Camera(
        position.x, position.y, position.z, camera.yRot(), camera.xRot());
  }

  private void finish(Run current, String failure) {
    if (!current.state.equals("RUNNING")) return;
    current.state = "WRITING";
    current.level = null;
    var error = failure;
    if (!error.isEmpty()) current.clock.interrupted(System.nanoTime());
    if (error.isEmpty() && current.clock.frames() < 2) error = "Fewer than two rendered frames";
    var receipt =
        new Receipt(
            1,
            "rwf-native-frame-pacing",
            "game-renderer-tail-monotonic-nanos",
            error.isEmpty() && current.clock.complete(),
            error,
            current.name,
            current.world,
            current.durationMs,
            current.targetFrames,
            current.clock.completion(),
            current.clock.observedElapsedNanos(),
            current.clock.measuredDurationNanos(),
            current.clock.tailNanos(),
            current.settings,
            current.runtime,
            current.clock.observations(),
            current.clock.frames() < 2 ? null : current.clock.quantiles());
    io.execute(
        () -> {
          try {
            Files.writeString(
                current.file,
                Protocol.JSON.writeValueAsString(receipt) + "\n",
                StandardOpenOption.CREATE_NEW);
            current.error = receipt.error();
            current.state = receipt.complete() ? "COMPLETE" : "FAILED";
          } catch (IOException | RuntimeException writeFailure) {
            current.error = writeFailure.toString();
            current.state = "FAILED";
          }
        });
  }

  @Override
  public void close() {
    var current = run;
    if (current != null && active())
      finish(current, "Client stopped during frame pacing measurement");
    io.close();
  }
}
