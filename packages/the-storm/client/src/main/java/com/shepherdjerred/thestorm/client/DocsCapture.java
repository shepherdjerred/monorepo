package com.shepherdjerred.thestorm.client;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;

/** Records ordinary player actions and UI without changing simulation or camera position. */
final class DocsCapture implements AutoCloseable {
  record Marker(String name, int frame) {}

  private final java.util.List<Marker> markers = new java.util.ArrayList<>();
  private final Path artifacts;
  private final ExecutorService io = VideoFrames.encoders();
  private final Map<Integer, VideoFrames.DocsObservation> observations = new HashMap<>();
  private @Nullable VideoFrames writer;
  private @Nullable FrameClock clock;
  private @Nullable CompletableFuture<Path> receipt;
  private @Nullable CompletableFuture<Path> preparation;
  private String name = "";
  private String state = "IDLE";
  private String error = "";
  private int total;
  private int width;
  private int height;

  DocsCapture(Path artifacts) {
    this.artifacts = artifacts;
  }

  boolean active() {
    return Set.of("ARMING", "READY", "CAPTURING", "DRAINING").contains(state);
  }

  CompletableFuture<Object> arm(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of("name", "frames"));
    if (active()) throw new IllegalStateException("Docs capture already active");
    name = Protocol.text(args, "name", 80);
    if (!name.matches("[a-zA-Z0-9_-]+")) throw new IllegalArgumentException("Invalid clip name");
    total = Protocol.integer(args, "frames", 1, 1800);
    if (client.getWindow().isIconified() || client.options.fullscreen().get())
      throw new IllegalStateException("Recording requires a visible windowed client");
    width = client.getWindow().getScreenWidth();
    height = client.getWindow().getScreenHeight();
    client
        .getWindow()
        .setWindowed(
            (int) Math.round(1280.0 * width / client.getWindow().getWidth()),
            (int) Math.round(720.0 * height / client.getWindow().getHeight()));
    error = "";
    observations.clear();
    markers.clear();
    receipt = null;
    clock = new FrameClock(total);
    var frames = new VideoFrames(artifacts.resolve(name), io);
    writer = frames;
    state = "ARMING";
    var prepared = frames.prepare();
    preparation = prepared;
    return prepared.handleAsync(
        (_, failure) -> {
          if (failure != null) {
            state = "FAILED";
            error = failure.toString();
            client.getWindow().setWindowed(width, height);
            throw new IllegalStateException("Docs capture setup failed", failure);
          }
          return status();
        },
        client);
  }

  Object start() {
    if (!state.equals("READY")) throw new IllegalStateException("Docs capture is not ready");
    state = "CAPTURING";
    return status();
  }

  void render(Minecraft client) {
    if (!Set.of("ARMING", "READY", "CAPTURING").contains(state)) return;
    var prepared = preparation;
    if (prepared == null || !prepared.isDone() || prepared.isCompletedExceptionally()) return;
    try {
      if (client.getWindow().isIconified())
        throw new IllegalStateException("Capture window minimized");
      var target = client.gameRenderer.mainRenderTarget();
      if (target.width != 1280 || target.height != 720) {
        if (state.equals("ARMING")) return;
        throw new IllegalStateException("Capture dimensions changed");
      }
      if (state.equals("ARMING")) {
        state = "READY";
        return;
      }
      if (state.equals("READY")) return;
      var timing = java.util.Objects.requireNonNull(clock);
      var frames = java.util.Objects.requireNonNull(writer);
      var now = System.nanoTime();
      if (!timing.sample(now)) return;
      captureFrame(client, timing, frames, now);
      if (timing.complete()) state = "DRAINING";
    } catch (RuntimeException failure) {
      fail(failure.toString());
    }
  }

  Object marker(JsonNode args) {
    Protocol.keys(args, Set.of("name"));
    var name = Protocol.text(args, "name", 80);
    if (!state.equals("CAPTURING") || markers.size() >= 200)
      throw new IllegalStateException("Markers require an active recording with room remaining");
    if (markers.stream().anyMatch(marker -> marker.name().equals(name)))
      throw new IllegalArgumentException("Duplicate recording marker " + name);
    var marker = new Marker(name, java.util.Objects.requireNonNull(clock).frames());
    markers.add(marker);
    return marker;
  }

  private void captureFrame(Minecraft client, FrameClock timing, VideoFrames frames, long now) {
    var index = timing.frames() - 1;
    var level = client.level;
    var screen = client.gui.screen();
    observations.put(
        index,
        new VideoFrames.DocsObservation(
            level == null ? "" : level.dimension().identifier().toString(),
            screen == null ? "" : screen.getTitle().getString()));
    var frame =
        new VideoFrames.Frame(
            index,
            timing.elapsed(now),
            level == null ? 0 : level.getGameTime(),
            VideoCapture.Camera.read(client));
    frames.reserve();
    try {
      Screenshot.takeScreenshot(
          client.gameRenderer.mainRenderTarget(), image -> frames.write(image, frame, false));
    } catch (RuntimeException failure) {
      frames.reject(failure.toString());
      throw failure;
    }
  }

  void tick(Minecraft client) {
    var frames = writer;
    var prepared = preparation;
    if (!state.equals("DRAINING")
        || frames == null
        || prepared == null
        || !prepared.isDone()
        || prepared.isCompletedExceptionally()
        || !frames.drained()) return;
    if (error.isEmpty()) error = frames.failure();
    var sealed = receipt;
    if (sealed == null) {
      receipt =
          frames.finishDocs(total, error, Map.copyOf(observations), java.util.List.copyOf(markers));
      client.getWindow().setWindowed(width, height);
    } else if (sealed.isDone()) {
      try {
        sealed.getNow(null);
      } catch (RuntimeException failure) {
        error = failure.toString();
      }
      state = error.isEmpty() ? "COMPLETE" : "FAILED";
    }
  }

  private void fail(String reason) {
    if (error.isEmpty()) error = reason;
    state = "DRAINING";
  }

  void cancel(Minecraft client) {
    if (active()) {
      fail("Capture cancelled");
      tick(client);
    }
  }

  Object status() {
    var timing = clock;
    return Map.of(
        "name",
        name,
        "state",
        state,
        "captured",
        timing == null ? 0 : timing.frames(),
        "total",
        total,
        "error",
        error,
        "receipt",
        artifacts.resolve(name).resolve("frames.json").toString());
  }

  @Override
  public void close() {
    io.shutdown();
  }
}
