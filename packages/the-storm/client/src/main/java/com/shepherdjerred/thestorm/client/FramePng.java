package com.shepherdjerred.thestorm.client;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.stream.MemoryCacheImageOutputStream;

/** Lossless, fast-compression PNG output with no process-global encoder settings or disk cache. */
final class FramePng {
  private FramePng() {}

  static void write(Path destination, int width, int height, int[] argb) throws IOException {
    if (width <= 0 || height <= 0 || Math.multiplyExact(width, height) != argb.length)
      throw new IllegalArgumentException("Frame pixel inventory does not match dimensions");
    var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
    image.setRGB(0, 0, width, height, argb, 0, width);
    var providers = ImageIO.getImageWritersByFormatName("PNG");
    if (!providers.hasNext()) throw new IllegalStateException("Required PNG writer is unavailable");
    var writer = providers.next();
    try {
      var parameters = writer.getDefaultWriteParam();
      parameters.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
      if (!parameters.isCompressionLossless())
        throw new IllegalStateException("Frame PNG writer must preserve every pixel");
      // The JDK PNG provider maps this value to Deflate level 1. PNG quality remains lossless.
      parameters.setCompressionQuality(8.0f / 9.0f);
      try (var file =
              Files.newOutputStream(
                  destination, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
          var output = new MemoryCacheImageOutputStream(file)) {
        writer.setOutput(output);
        writer.write(null, new IIOImage(image, null, null), parameters);
      }
    } finally {
      writer.dispose();
    }
  }
}
