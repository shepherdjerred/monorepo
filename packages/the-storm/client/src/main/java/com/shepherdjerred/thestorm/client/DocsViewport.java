package com.shepherdjerred.thestorm.client;

import static java.util.Objects.requireNonNull;

import java.io.IOException;
import java.io.UncheckedIOException;
import net.minecraft.client.Minecraft;

/** One physical framebuffer size on ordinary and high-density displays. */
final class DocsViewport {
  record Size(int width, int height) {
    Size {
      if (width <= 0 || height <= 0)
        throw new IllegalArgumentException("Invalid viewport dimensions");
    }
  }

  private static final Size TARGET = load();

  private DocsViewport() {}

  static Size target() {
    return TARGET;
  }

  static Size windowedSize(
      int windowWidth, int windowHeight, int framebufferWidth, int framebufferHeight) {
    new Size(windowWidth, windowHeight);
    new Size(framebufferWidth, framebufferHeight);
    return new Size(
        (int) Math.round((double) TARGET.width() * windowWidth / framebufferWidth),
        (int) Math.round((double) TARGET.height() * windowHeight / framebufferHeight));
  }

  static void apply(Minecraft client) {
    var window = client.getWindow();
    var size =
        windowedSize(
            window.getScreenWidth(),
            window.getScreenHeight(),
            window.getWidth(),
            window.getHeight());
    window.setWindowed(size.width(), size.height());
  }

  private static Size load() {
    try (var source =
        requireNonNull(DocsViewport.class.getResourceAsStream("/storm-docs-video.json"))) {
      var contract = Protocol.JSON.readTree(source);
      return new Size(
          contract.required("width").intValue(), contract.required("height").intValue());
    } catch (IOException error) {
      throw new UncheckedIOException("Cannot read docs viewport contract", error);
    }
  }
}
