package com.shepherdjerred.thestorm.client;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;

/** Checks a real framebuffer, cancellation, and rejection of the driver's 20 Hz rendering. */
public final class VideoGameTest implements FabricClientGameTest {
  public VideoGameTest() {}

  @Override
  public void runTest(ClientGameTestContext context) {
    var directory = output();
    var capture = new VideoCapture(directory);
    var ticking = new AtomicBoolean(true);
    ClientTickEvents.END_CLIENT_TICK.register(
        client -> {
          if (ticking.get()) capture.tick(client);
        });
    context.runOnClient(client -> RenderCapture.install(capture));
    try (var world = context.worldBuilder().create()) {
      world.getConnection().waitForChunksRender();
      world.getServer().runCommand("gamemode spectator @a");
      world.getServer().runCommand("tp @a 0 120 0 135 30");
      context.waitFor(client -> client.player != null && client.player.isSpectator());
      context.runOnClient(
          client -> {
            client.gui.setScreen(null);
            client.options.pauseOnLostFocus = false;
          });
      context.waitTicks(40);
      var hud = context.computeOnClient(client -> client.gui.hud.isHidden());
      arm(context, capture, "native-one-frame", 1);
      context.waitFor(client -> "READY".equals(capture.status().state()), 600);
      context.runOnClient(client -> capture.start());
      context.waitFor(
          client -> {
            var state = capture.status();
            if ("FAILED".equals(state.state())) throw new IllegalStateException(state.toString());
            return "COMPLETE".equals(state.state());
          },
          2400);
      var receipt =
          Protocol.JSON.readTree(
              Files.readString(directory.resolve("native-one-frame/frames.json")));
      if (!receipt.required("complete").booleanValue() || receipt.required("frames").size() != 1) {
        throw new IllegalStateException("Native frame receipt is incomplete");
      }
      var restored = context.computeOnClient(client -> client.gui.hud.isHidden());
      if (!hud.equals(restored)) throw new IllegalStateException("Capture did not restore the HUD");
      arm(context, capture, "native-cancelled", 60);
      context.waitFor(client -> "READY".equals(capture.status().state()), 600);
      context.runOnClient(client -> capture.cancel(client));
      context.waitFor(client -> "FAILED".equals(capture.status().state()), 600);
      var cancelled =
          Protocol.JSON.readTree(
              Files.readString(directory.resolve("native-cancelled/frames.json")));
      if (cancelled.required("complete").booleanValue()) {
        throw new IllegalStateException("Cancelled capture was presented as complete");
      }
      arm(context, capture, "native-missed-slot", 900);
      context.waitFor(client -> "READY".equals(capture.status().state()), 600);
      context.runOnClient(client -> capture.start());
      context.waitFor(client -> "FAILED".equals(capture.status().state()), 600);
      var failed = context.computeOnClient(client -> capture.status());
      if (!failed.error().contains("missed frame")) {
        throw new IllegalStateException("Slow rendering failed for an unexpected reason");
      }
    } catch (IOException e) {
      throw new IllegalStateException("Cannot read rendered evidence", e);
    } finally {
      context.runOnClient(
          client -> {
            capture.cancel(client);
            RenderCapture.remove(capture);
          });
      ticking.set(false);
      capture.close();
    }
  }

  private static void arm(
      ClientGameTestContext context, VideoCapture capture, String name, int frames) {
    var args =
        Protocol.JSON.valueToTree(java.util.Map.of("name", name, "frames", frames, "fov", 70));
    var future = context.computeOnClient(client -> capture.arm(client, args));
    context.waitFor(client -> future.isDone(), 600);
    var unusedReply = future.getNow(null);
  }

  private static Path output() {
    try {
      var directory = Files.createDirectories(Path.of("rendered-videos").toAbsolutePath());
      return Files.createTempDirectory(directory, "native-");
    } catch (IOException e) {
      throw new IllegalStateException("Cannot create native capture output", e);
    }
  }
}
