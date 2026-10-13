package com.shepherdjerred.thestorm.rwfbots.domain.map;

import java.io.DataInput;
import java.io.DataOutput;
import java.io.IOException;

/** Reversible float-bit deltas in byte planes expose spatial repetition to deflate. */
final class DistanceLayout {
  static final String ENCODING = "distance-f32-delta-be-planes-v1";

  private DistanceLayout() {}

  static void write(float[] values, DataOutput out) throws IOException {
    out.writeInt(values.length);
    for (var shift = 24; shift >= 0; shift -= 8) {
      var previous = 0;
      for (var value : values) {
        var bits = Float.floatToRawIntBits(value);
        out.writeByte((bits - previous) >>> shift);
        previous = bits;
      }
    }
  }

  /** The caller validates the count before allocating; scratch is bounded to this one array. */
  static float[] read(int count, DataInput in) throws IOException {
    var deltas = new int[count];
    for (var shift = 24; shift >= 0; shift -= 8) {
      for (var i = 0; i < count; i++) {
        deltas[i] |= in.readUnsignedByte() << shift;
      }
    }
    var values = new float[count];
    var bits = 0;
    for (var i = 0; i < count; i++) {
      bits += deltas[i];
      values[i] = Float.intBitsToFloat(bits);
    }
    return values;
  }
}
