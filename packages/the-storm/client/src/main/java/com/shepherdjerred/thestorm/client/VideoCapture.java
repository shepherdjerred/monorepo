package com.shepherdjerred.thestorm.client;

import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.phys.Vec3;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;

/** Session-scoped framebuffer capture. It never captures a desktop or participates in a match. */
final class VideoCapture implements AutoCloseable {
  record Status(String name, String state, int captured, int total, String error, String receipt) {}

  record Camera(
      List<Double> position, float yaw, float pitch, float fov, boolean hud, boolean nameplates) {
    static final double POSITION_EPSILON = 0.000001;
    static final double ANGLE_EPSILON = 0.0001;

    boolean samePose(Camera other) {
      for (int index = 0; index < position.size(); index++) {
        if (Math.abs(position.get(index) - other.position.get(index)) > POSITION_EPSILON)
          return false;
      }
      return Math.abs(yaw - other.yaw) <= ANGLE_EPSILON
          && Math.abs(pitch - other.pitch) <= ANGLE_EPSILON
          && Math.abs(fov - other.fov) <= ANGLE_EPSILON
          && hud == other.hud
          && nameplates == other.nameplates;
    }

    static Camera read(Minecraft client) {
      var camera = client.gameRenderer.mainCamera();
      var p = camera.position();
      return new Camera(
          List.of(p.x, p.y, p.z),
          camera.yRot(),
          camera.xRot(),
          camera.getFov(),
          !client.gui.hud.isHidden(),
          !RenderCapture.hideNames());
    }
  }

  private static final class Run {
    final String name;
    final FrameClock clock;
    final VideoFrames writer;
    final int total;
    final int fov;
    String state = "STARTING";
    String error = "";
    @Nullable Vec3 position;
    @Nullable ClientLevel level;
    float yaw;
    float pitch;
    int settledFrames;
    @Nullable Camera camera;
    @Nullable CompletableFuture<Path> receipt;

    Run(Path artifacts, ExecutorService io, JsonNode args) {
      Protocol.keys(args, Set.of("name", "frames", "fov"));
      name = Protocol.text(args, "name", 80);
      if (!name.matches("[a-zA-Z0-9_-]+")) throw new IllegalArgumentException("Invalid clip name");
      total = Protocol.integer(args, "frames", 1, 1800);
      fov = Protocol.integer(args, "fov", 30, 110);
      clock = new FrameClock(total);
      writer = new VideoFrames(artifacts.resolve(name), io);
    }
  }

  private final Path artifacts;
  private final ExecutorService io =
      Executors.newSingleThreadExecutor(Thread.ofVirtual().name("storm-frame-writer").factory());
  private @Nullable Run run;
  private int previousFov;
  private double previousEffect;
  private boolean previousBob;
  private boolean previousHud;
  private CameraType previousCamera = CameraType.FIRST_PERSON;
  private int previousWidth;
  private int previousHeight;

  VideoCapture(Path artifacts) {
    this.artifacts = artifacts;
  }

  boolean active() {
    var current = run;
    return current != null && !Set.of("COMPLETE", "FAILED").contains(current.state);
  }

  CompletableFuture<Object> arm(Minecraft client, JsonNode args) {
    if (active()) throw new IllegalStateException("A rendered capture is already active");
    if (client.getWindow().isFullscreen() || client.getWindow().isMinimized()) {
      throw new IllegalStateException("Recording requires a visible windowed preview");
    }
    if (client.gui.screen() != null || client.gui.overlay() != null) {
      throw new IllegalStateException("Close screens and overlays before recording");
    }
    var player = java.util.Objects.requireNonNull(client.player);
    if (!player.isSpectator())
      throw new IllegalStateException("Recording requires a spectator camera");
    var current = new Run(artifacts, io, args);
    run = current;
    return current
        .writer
        .prepare()
        .handleAsync(
            (directory, error) -> {
              if (error != null) {
                current.state = "FAILED";
                current.error = error.toString();
                throw new CompletionException(error);
              }
              if (!current.state.equals("STARTING")) {
                throw new IllegalStateException("Capture cancelled during setup");
              }
              try {
                configure(client, current);
                return status();
              } catch (RuntimeException e) {
                fail(current, e.toString());
                finish(client, current);
                throw e;
              }
            },
            client);
  }

  Object start() {
    var current = java.util.Objects.requireNonNull(run, "No rendered capture exists");
    if (!current.state.equals("READY")) {
      throw new IllegalStateException("Rendered camera is not ready");
    }
    current.state = "CAPTURING";
    return status();
  }

  private void configure(Minecraft client, Run current) {
    var player = java.util.Objects.requireNonNull(client.player);
    previousFov = client.options.fov().get();
    previousEffect = client.options.fovEffectScale().get();
    previousBob = client.options.bobView().get();
    previousHud = client.gui.hud.isHidden();
    previousCamera = client.options.getCameraType();
    var window = client.getWindow();
    previousWidth = window.getScreenWidth();
    previousHeight = window.getScreenHeight();
    window.setWindowed(
        (int) Math.round(1280.0 * previousWidth / window.getWidth()),
        (int) Math.round(720.0 * previousHeight / window.getHeight()));
    client.options.fov().set(current.fov);
    client.options.fovEffectScale().set(0.0);
    client.options.bobView().set(false);
    client.options.setCameraType(CameraType.FIRST_PERSON);
    if (!client.gui.hud.isHidden()) client.gui.hud.toggle();
    current.position = player.position();
    current.level = client.level;
    current.yaw = player.getYRot();
    current.pitch = player.getXRot();
    current.state = "ARMING";
    tick(client);
  }

  void tick(Minecraft client) {
    var current = run;
    if (current == null || !active()) return;
    var position = current.position;
    var player = client.player;
    if (position != null
        && (player == null || !java.util.Objects.equals(client.level, current.level))) {
      fail(current, "Recording world disconnected or changed");
    }
    if (position != null && player != null) {
      player.setPos(position);
      player.setYRot(current.yaw);
      player.setXRot(current.pitch);
      player.setDeltaMovement(Vec3.ZERO);
      player.setOldPosAndRot();
    }
    finish(client, current);
  }

  void render(Minecraft client) {
    var current = run;
    if (current == null || !Set.of("ARMING", "READY", "CAPTURING").contains(current.state)) return;
    try {
      if (current.state.equals("ARMING")) {
        settle(client, current);
        return;
      }
      validate(client, current);
      if (current.state.equals("READY")) return;
      var now = System.nanoTime();
      if (!current.clock.sample(now)) return;
      var index = current.clock.frames() - 1;
      var frame =
          new VideoFrames.Frame(
              index,
              current.clock.elapsed(now),
              java.util.Objects.requireNonNull(client.level).getGameTime(),
              Camera.read(client));
      current.writer.reserve();
      requestFrame(client, current, frame);
      if (current.clock.complete()) current.state = "DRAINING";
    } catch (RuntimeException e) {
      fail(current, e.toString());
    }
  }

  private static void settle(Minecraft client, Run current) {
    var observed = Camera.read(client);
    if (Math.abs(observed.fov() - current.fov) > 0.01) {
      current.settledFrames = 0;
      return;
    }
    if (!observed.equals(current.camera)) current.settledFrames = 0;
    current.camera = observed;
    current.settledFrames++;
    if (current.settledFrames >= 3) {
      validate(client, current);
      current.state = "READY";
    }
  }

  private static void requestFrame(Minecraft client, Run current, VideoFrames.Frame frame) {
    try {
      Screenshot.takeScreenshot(
          client.gameRenderer.mainRenderTarget(), image -> current.writer.write(image, frame));
    } catch (RuntimeException e) {
      current.writer.reject(e.toString());
      throw e;
    }
  }

  private static void validate(Minecraft client, Run current) {
    var player = client.player;
    if (player == null
        || client.level == null
        || !client.level.equals(current.level)
        || !player.isSpectator()
        || client.gui.screen() != null
        || client.gui.overlay() != null
        || !client.gui.hud.isHidden()
        || client.options.getCameraType() != CameraType.FIRST_PERSON
        || client.gameRenderer.mainRenderTarget().width != 1280
        || client.gameRenderer.mainRenderTarget().height != 720) {
      throw new IllegalStateException("Recording camera, screen or render dimensions changed");
    }
    var observed = Camera.read(client);
    var expected = current.camera;
    if (expected == null) {
      if (Math.abs(observed.fov() - current.fov) > 0.01) {
        throw new IllegalStateException("Recording FOV has not settled");
      }
      current.camera = observed;
    } else if (!expected.samePose(observed)) {
      throw new IllegalStateException(
          "Rendered camera moved during capture: " + expected + " -> " + observed);
    }
    if (!current.writer.failure().isEmpty()) {
      throw new IllegalStateException(current.writer.failure());
    }
  }

  Status status() {
    var current = java.util.Objects.requireNonNull(run, "No rendered capture exists");
    return new Status(
        current.name,
        current.state,
        current.clock.frames(),
        current.total,
        current.error,
        artifacts.resolve(current.name).resolve("frames.json").toString());
  }

  void cancel(Minecraft client) {
    var current = run;
    if (current == null || !active()) return;
    if (current.receipt != null) {
      finish(client, current);
      return;
    }
    fail(current, "Capture cancelled");
    finish(client, current);
  }

  private static void fail(Run current, String reason) {
    if (current.error.isEmpty()) current.error = reason;
    current.state = "DRAINING";
  }

  private void finish(Minecraft client, Run current) {
    if (!current.state.equals("DRAINING")) return;
    if (current.error.isEmpty() && !current.writer.failure().isEmpty())
      current.error = current.writer.failure();
    if (!current.writer.drained()) return;
    var receipt = current.receipt;
    if (receipt == null) {
      current.receipt = current.writer.finish(current.total, current.error);
      restore(client, current);
    } else if (receipt.isDone()) {
      try {
        receipt.getNow(null);
      } catch (RuntimeException e) {
        current.error = e.toString();
      }
      current.state = current.error.isEmpty() ? "COMPLETE" : "FAILED";
    }
  }

  private void restore(Minecraft client, Run current) {
    if (current.position == null) return;
    client.options.fov().set(previousFov);
    client.options.fovEffectScale().set(previousEffect);
    client.options.bobView().set(previousBob);
    client.options.setCameraType(previousCamera);
    if (client.gui.hud.isHidden() != previousHud) client.gui.hud.toggle();
    current.position = null;
    client.getWindow().setWindowed(previousWidth, previousHeight);
  }

  @Override
  public void close() {
    io.shutdown();
  }
}
