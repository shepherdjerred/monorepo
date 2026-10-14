package com.shepherdjerred.thestorm.rwf.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import org.junit.jupiter.api.Test;

final class SchematicDigestTest {
  @Test
  void streamingMatchesTheOriginalCanonicalBytesAcrossBufferBoundaries()
      throws NoSuchAlgorithmException {
    var palette = List.of("minecraft:air", "minecraft:oak_log[axis=y]", "test:é");
    for (var count : new int[] {1, 2047, 2048, 2049, 6147}) {
      var size = new Schematic.Dimensions(count, 1, 1);
      var indices = new int[count];
      var streamed = new SchematicDigest(size, palette);
      for (var index = 0; index < count; index++) {
        indices[index] = index % palette.size();
        streamed.add(indices[index]);
      }
      var expected = original(size, palette, indices);
      assertThat(streamed.finish()).isEqualTo(expected);
      assertThat(Schematic.sha256(size, palette, indices)).isEqualTo(expected);
    }
  }

  @Test
  void exactBlockCountAndSingleCompletionAreRequired() {
    var digest = new SchematicDigest(new Schematic.Dimensions(2, 1, 1), List.of("minecraft:air"));
    digest.add(0);
    assertThatThrownBy(digest::finish).hasMessageContaining("expected 2 blocks, got 1");
    digest.add(0);
    assertThatThrownBy(() -> digest.add(0)).hasMessageContaining("no remaining blocks");
    assertThat(digest.finish()).matches("[0-9a-f]{64}");
    assertThatThrownBy(digest::finish).hasMessageContaining("already finished");
    assertThatThrownBy(() -> digest.add(0)).hasMessageContaining("no remaining blocks");
  }

  /** The original one-buffer implementation is an independent wire-format oracle. */
  private static String original(Schematic.Dimensions size, List<String> palette, int[] indices)
      throws NoSuchAlgorithmException {
    var digest = MessageDigest.getInstance("SHA-256");
    digest.update(
        ("sponge-v3\n" + size.width() + " " + size.height() + " " + size.length() + "\n")
            .getBytes(StandardCharsets.UTF_8));
    for (var index = 0; index < palette.size(); index++)
      digest.update((index + "\t" + palette.get(index) + "\n").getBytes(StandardCharsets.UTF_8));
    var bytes = ByteBuffer.allocate(indices.length * Integer.BYTES);
    for (var index : indices) bytes.putInt(index);
    digest.update(bytes.array());
    return HexFormat.of().formatHex(digest.digest());
  }
}
