package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.util.Arrays;
import java.util.Random;
import org.junit.jupiter.api.Test;

final class DistanceLayoutTest {
  @Test
  void writesSpecifiedBigEndianDeltaPlanes() throws IOException {
    var values = new float[] {0, 1, Float.intBitsToFloat(0x3f800001), Float.POSITIVE_INFINITY};
    assertThat(encoded(values))
        .containsExactly(
            0,
            0,
            0,
            4,
            0,
            0x3f,
            0,
            0x3f,
            0,
            (byte) 0x80,
            0,
            (byte) 0xff,
            0,
            0,
            0,
            (byte) 0xff,
            0,
            0,
            1,
            (byte) 0xff);
  }

  @Test
  void roundTripsEveryBitOfAdversarialAndSeededFloatPatterns() throws IOException {
    var random = new Random(196);
    var patterns = new int[4096];
    for (var i = 0; i < patterns.length; i++) patterns[i] = random.nextInt();
    patterns[0] = 0;
    patterns[1] = Integer.MIN_VALUE;
    patterns[2] = 1;
    patterns[3] = 0x7f800000;
    patterns[4] = 0xff800000;
    patterns[5] = 0x7fc01234;
    patterns[6] = 0x7f800001;
    var values = new float[patterns.length];
    for (var i = 0; i < values.length; i++) values[i] = Float.intBitsToFloat(patterns[i]);
    var encoded = encoded(values);
    var back = decoded(encoded);
    for (var i = 0; i < values.length; i++)
      assertThat(Float.floatToRawIntBits(back[i])).as("float bits at %s", i).isEqualTo(patterns[i]);
    assertThat(encoded(back)).isEqualTo(encoded);
    Arrays.fill(encoded, (byte) 0);
    Arrays.fill(values, 0);
    assertThat(Float.floatToRawIntBits(back[1])).isEqualTo(Integer.MIN_VALUE);
    assertThat(Float.floatToRawIntBits(back[5])).isEqualTo(0x7fc01234);
  }

  @Test
  void handlesEmptyAndSingleElementArrays() throws IOException {
    assertThat(decoded(encoded(new float[0]))).isEmpty();
    assertThat(decoded(encoded(new float[] {Float.MAX_VALUE}))).containsExactly(Float.MAX_VALUE);
  }

  @Test
  void rejectsTruncationWithinEveryPlane() throws IOException {
    var wire = encoded(new float[] {1, 2, 3, Float.POSITIVE_INFINITY});
    for (var length = 4; length < wire.length; length++) {
      var truncated = Arrays.copyOf(wire, length);
      assertThatThrownBy(() -> decoded(truncated)).isInstanceOf(EOFException.class);
    }
  }

  private static byte[] encoded(float[] values) throws IOException {
    var bytes = new ByteArrayOutputStream();
    DistanceLayout.write(values, new DataOutputStream(bytes));
    return bytes.toByteArray();
  }

  private static float[] decoded(byte[] bytes) throws IOException {
    var in = new DataInputStream(new ByteArrayInputStream(bytes));
    var values = DistanceLayout.read(in.readInt(), in);
    assertThat(in.available()).isZero();
    return values;
  }
}
