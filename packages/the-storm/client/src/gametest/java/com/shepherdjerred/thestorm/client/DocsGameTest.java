package com.shepherdjerred.thestorm.client;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;

/** Proves that the docs recorder captures a genuine ordinary-player inventory screen. */
public final class DocsGameTest implements FabricClientGameTest {
  public DocsGameTest() {}

  @Override
  public void runTest(ClientGameTestContext context) {
    var directory = output();
    var capture = new DocsCapture(directory);
    var ticking = new AtomicBoolean(true);
    ClientTickEvents.END_CLIENT_TICK.register(
        client -> {
          if (ticking.get()) capture.tick(client);
        });
    context.runOnClient(client -> RenderCapture.installDocs(capture));
    try (var world = context.worldBuilder().create()) {
      world.getConnection().waitForChunksRender();
      context.runOnClient(
          client -> {
            client.options.pauseOnLostFocus = false;
            client.options.enableVsync().set(false);
            client.options.framerateLimit().set(120);
          });
      context.getInput().pressKey(options -> options.keyInventory);
      context.waitForScreen(InventoryScreen.class);
      // The gametest driver advances at 20 Hz. A genuine frame proves menu rendering;
      // the adverse-rate check below proves it cannot fabricate a 30 fps sequence.
      var args = Protocol.JSON.valueToTree(Map.of("name", "inventory", "frames", 1));
      var ready = context.computeOnClient(client -> capture.arm(client, args));
      context.waitFor(client -> ready.isDone(), 600);
      var unusedReply = ready.getNow(null);
      context.waitFor(client -> state(capture).equals("READY"), 600);
      context.runOnClient(
          client -> {
            capture.start();
            capture.marker(Protocol.JSON.valueToTree(Map.of("name", "inventory-visible")));
          });
      context.waitFor(
          client -> {
            if (state(capture).equals("FAILED"))
              throw new IllegalStateException(capture.status().toString());
            return state(capture).equals("COMPLETE");
          },
          600);
      var receipt =
          Protocol.JSON.readTree(Files.readString(directory.resolve("inventory/frames.json")));
      if (receipt.required("schema").intValue() != 4
          || !receipt.required("complete").booleanValue()
          || receipt.required("frames").size() != 1
          || receipt.required("markers").size() != 1
          || receipt
              .required("frames")
              .get(0)
              .required("observation")
              .required("screen")
              .stringValue()
              .isEmpty())
        throw new IllegalStateException("Docs recorder lost the actual menu observation");
      verifyCancellation(context, capture, directory);
      verifyMissedFrame(context, capture, directory);
    } catch (IOException error) {
      throw new IllegalStateException("Cannot read docs capture", error);
    } finally {
      context.runOnClient(
          client -> {
            capture.cancel(client);
            RenderCapture.removeDocs(capture);
          });
      ticking.set(false);
      capture.close();
    }
  }

  private static void verifyMissedFrame(
      ClientGameTestContext context, DocsCapture capture, Path directory) throws IOException {
    context.runOnClient(client -> client.options.framerateLimit().set(20));
    var ready =
        context.computeOnClient(
            client ->
                capture.arm(
                    client, Protocol.JSON.valueToTree(Map.of("name", "slow-menu", "frames", 30))));
    context.waitFor(client -> ready.isDone() && state(capture).equals("READY"), 600);
    context.runOnClient(client -> capture.start());
    context.waitFor(client -> state(capture).equals("FAILED"), 600);
    var receipt =
        Protocol.JSON.readTree(Files.readString(directory.resolve("slow-menu/frames.json")));
    if (receipt.required("complete").booleanValue()
        || !receipt.required("error").stringValue().contains("missed frame"))
      throw new IllegalStateException("Slow menu capture did not enforce its sampling contract");
  }

  private static void verifyCancellation(
      ClientGameTestContext context, DocsCapture capture, Path directory) throws IOException {
    var arming =
        context.computeOnClient(
            client -> {
              var future =
                  capture.arm(
                      client, Protocol.JSON.valueToTree(Map.of("name", "cancelled", "frames", 30)));
              capture.cancel(client);
              return future;
            });
    context.waitFor(client -> arming.isDone() && state(capture).equals("FAILED"), 600);
    var receipt =
        Protocol.JSON.readTree(Files.readString(directory.resolve("cancelled/frames.json")));
    if (receipt.required("complete").booleanValue()
        || receipt.required("error").stringValue().isEmpty())
      throw new IllegalStateException("Cancelled capture was publishable");
  }

  private static String state(DocsCapture capture) {
    return Protocol.JSON.valueToTree(capture.status()).required("state").stringValue();
  }

  private static Path output() {
    try {
      return Files.createTempDirectory(
          Files.createDirectories(Path.of("rendered-videos").toAbsolutePath()), "docs-");
    } catch (IOException error) {
      throw new IllegalStateException("Cannot create capture directory", error);
    }
  }
}
