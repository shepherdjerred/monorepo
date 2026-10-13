package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.zip.DeflaterOutputStream;
import java.util.zip.InflaterInputStream;
import org.junit.jupiter.api.Test;

/** Sections must remain bounded views and decoded arrays must outlive their input independently. */
final class NavCodecBoundaryTest {
  private final NavArtifact nav = SyntheticMap.bake();

  @Test
  void rejectsNegativeAndOversizedSectionLengths() throws IOException {
    var raw = raw(NavCodec.encode(nav));
    for (var length : new int[] {-1, raw.length + 1}) {
      var changed = raw.clone();
      ByteBuffer.wrap(changed).putInt(4, length);
      assertThat(error(encoded(changed))).contains("section META length is wrong");
    }
  }

  @Test
  void aShortSectionCannotReadThroughItsBoundaryIntoTheNextSection() throws IOException {
    var raw = raw(NavCodec.encode(nav));
    var length = ByteBuffer.wrap(raw).getInt(4);
    ByteBuffer.wrap(raw).putInt(4, length - 1);
    assertThat(NavCodec.decode(encoded(raw))).isInstanceOf(Result.Err.class);
  }

  @Test
  void rejectsUnreadBytesWithinASection() throws IOException {
    var raw = raw(NavCodec.encode(nav));
    var length = ByteBuffer.wrap(raw).getInt(4);
    var boundary = 8 + length;
    var changed = new byte[raw.length + 1];
    System.arraycopy(raw, 0, changed, 0, boundary);
    changed[boundary] = 0x55;
    System.arraycopy(raw, boundary, changed, boundary + 1, raw.length - boundary);
    ByteBuffer.wrap(changed).putInt(4, length + 1);
    assertThat(error(encoded(changed))).contains("section META has trailing bytes");
  }

  @Test
  void rejectsWrongSectionOrderAndBytesAfterTheLastSection() throws IOException {
    var raw = raw(NavCodec.encode(nav));
    var changed = raw.clone();
    ByteBuffer.wrap(changed).putInt(0, 999);
    assertThat(error(encoded(changed))).contains("expected section META but found id 999");
    assertThat(error(encoded(Arrays.copyOf(raw, raw.length + 1))))
        .contains("trailing bytes after the last section");
  }

  @Test
  void rejectsUnknownAndMissingDistanceEncodingTags() throws IOException {
    var raw = raw(NavCodec.encode(nav));
    var in = new DataInputStream(new ByteArrayInputStream(raw));
    in.skipNBytes(16);
    in.readUTF();
    var tagOffset = raw.length - in.available();
    var tagLength = in.readUnsignedShort() + 2;
    var changed = raw.clone();
    changed[tagOffset + 2] = 'X';
    assertThat(error(encoded(changed))).contains("unsupported distance encoding");
    var untagged = new byte[raw.length - tagLength];
    System.arraycopy(raw, 0, untagged, 0, tagOffset);
    System.arraycopy(
        raw, tagOffset + tagLength, untagged, tagOffset, raw.length - tagOffset - tagLength);
    ByteBuffer.wrap(untagged).putInt(4, ByteBuffer.wrap(raw).getInt(4) - tagLength);
    assertThat(error(encoded(untagged))).contains("unsupported distance encoding");
  }

  @Test
  void rejectsInvalidDistanceCountsAndTruncatedPlaneSections() throws IOException {
    var raw = raw(NavCodec.encode(nav));
    var section = sectionOffset(raw, 9);
    var payload = section + 8;
    var nameLength = Short.toUnsignedInt(ByteBuffer.wrap(raw).getShort(payload + 4));
    var countOffset = payload + 4 + 2 + nameLength;
    for (var count : new int[] {-1, (1 << 26) + 1}) {
      var changed = raw.clone();
      ByteBuffer.wrap(changed).putInt(countOffset, count);
      assertThat(error(encoded(changed))).contains("implausible count");
    }
    var shortened = raw.clone();
    ByteBuffer.wrap(shortened).putInt(section + 4, countOffset - payload + 4);
    assertThat(NavCodec.decode(encoded(shortened))).isInstanceOf(Result.Err.class);
  }

  @Test
  void decodedStateOwnsItsArraysAfterTheInputAndExportedCopiesAreChanged() {
    var original = NavCodec.encode(nav);
    var input = original.clone();
    var decoded = NavCodec.decode(input);
    assertThat(decoded).isInstanceOf(Result.Ok.class);
    var back = ((Result.Ok<NavArtifact, NavCodec.CodecError>) decoded).value();
    Arrays.fill(input, (byte) 0);
    Arrays.fill(back.graph().nodeData().cells(), -1);
    Arrays.fill(back.graph().nodeData().halfHeight(), (byte) 1);
    Arrays.fill(back.graph().topology().edgeTo(), -1);
    Arrays.fill(back.graph().edgeData().cost(), Float.NaN);
    for (var field : back.distanceFields().values()) Arrays.fill(field.values(), Float.NaN);
    assertThat(back).isEqualTo(nav);
    assertThat(NavCodec.encode(back)).isEqualTo(original);
    assertThat(back.validate()).isEmpty();
  }

  @Test
  void rejectsInvalidDistanceValuesInOtherwiseWellFormedPlanePayloads() throws IOException {
    var raw = raw(NavCodec.encode(nav));
    var payload = sectionOffset(raw, 9) + 8;
    var nameLength = Short.toUnsignedInt(ByteBuffer.wrap(raw).getShort(payload + 4));
    var countOffset = payload + 4 + 2 + nameLength;
    var values = new float[ByteBuffer.wrap(raw).getInt(countOffset)];
    for (var invalid : new float[] {Float.NaN, -1, Float.NEGATIVE_INFINITY}) {
      values[0] = invalid;
      var buffer = new ByteArrayOutputStream();
      DistanceLayout.write(values, new DataOutputStream(buffer));
      var changed = raw.clone();
      var field = buffer.toByteArray();
      System.arraycopy(field, 0, changed, countOffset, field.length);
      assertThat(error(encoded(changed))).contains("distance must be non-negative and not NaN");
    }
  }

  private static byte[] raw(byte[] encoded) throws IOException {
    try (var stream =
        new InflaterInputStream(new ByteArrayInputStream(encoded, 16, encoded.length - 16))) {
      return stream.readAllBytes();
    }
  }

  private static int sectionOffset(byte[] raw, int wanted) {
    var buffer = ByteBuffer.wrap(raw);
    var offset = 0;
    while (buffer.getInt(offset) != wanted) offset += 8 + buffer.getInt(offset + 4);
    return offset;
  }

  private static byte[] encoded(byte[] raw) throws IOException {
    var compressed = new ByteArrayOutputStream();
    try (var stream = new DeflaterOutputStream(compressed)) {
      stream.write(raw);
    }
    var bytes = compressed.toByteArray();
    return ByteBuffer.allocate(16 + bytes.length)
        .putInt(NavCodec.MAGIC)
        .putInt(NavCodec.FORMAT_VERSION)
        .putInt(raw.length)
        .putInt(bytes.length)
        .put(bytes)
        .array();
  }

  private static String error(byte[] bytes) {
    var result = NavCodec.decode(bytes);
    assertThat(result).isInstanceOf(Result.Err.class);
    return ((Result.Err<NavArtifact, NavCodec.CodecError>) result).error().message();
  }
}
