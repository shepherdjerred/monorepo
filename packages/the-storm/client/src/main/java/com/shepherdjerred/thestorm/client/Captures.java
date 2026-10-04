package com.shepherdjerred.thestorm.client;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ForkJoinPool;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import tools.jackson.databind.JsonNode;

final class Captures {
  private final Path directory;

  Captures(Path directory) {
    this.directory = directory;
  }

  CompletableFuture<Object> capture(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of("name"));
    var name = Protocol.text(args, "name", 80);
    if (!name.matches("[a-zA-Z0-9_-]+"))
      throw new IllegalArgumentException("Invalid screenshot name");
    var destination = directory.resolve(name + ".png");
    var result = new CompletableFuture<Object>();
    Screenshot.takeScreenshot(
        client.gameRenderer.mainRenderTarget(),
        image ->
            ForkJoinPool.commonPool()
                .execute(
                    () -> {
                      try (image) {
                        image.writeToFile(destination);
                        result.complete(Map.of("path", destination.toString()));
                      } catch (IOException | RuntimeException e) {
                        result.completeExceptionally(e);
                      }
                    }));
    return result;
  }
}
