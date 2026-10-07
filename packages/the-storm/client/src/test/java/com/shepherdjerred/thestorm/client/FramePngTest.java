package com.shepherdjerred.thestorm.client;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class FramePngTest {
  @Test
  void preservesChannelOrderAlphaAndRowsWithoutOverwriting(@TempDir Path directory)
      throws Exception {
    var pixels = new int[] {0xffff0000, 0xff00ff00, 0xff0000ff, 0x00123456, 0x7fabcdef, 0xff102030};
    var target = directory.resolve("frame.png");
    FramePng.write(target, 3, 2, pixels);
    var decoded = java.util.Objects.requireNonNull(ImageIO.read(target.toFile()));
    assertArrayEquals(pixels, decoded.getRGB(0, 0, 3, 2, null, 0, 3));
    assertThrows(FileAlreadyExistsException.class, () -> FramePng.write(target, 3, 2, pixels));
    assertThrows(
        IllegalArgumentException.class,
        () -> FramePng.write(directory.resolve("invalid.png"), 2, 2, pixels));
  }
}
