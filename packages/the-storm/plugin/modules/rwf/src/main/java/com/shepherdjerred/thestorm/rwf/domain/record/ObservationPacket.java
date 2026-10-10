package com.shepherdjerred.thestorm.rwf.domain.record;

import java.nio.ByteBuffer;
import java.util.List;

/** Echoed server tick ties client controls to a preceding observation despite network delay. */
public final class ObservationPacket {
  public static final String CHANNEL = "thestorm:rwf_observation";

  private ObservationPacket() {}

  public static byte[] encode(long tick, List<Double> values) {
    if (tick < 0 || values.isEmpty() || values.size() > 256)
      throw new IllegalArgumentException("invalid observation packet");
    var buffer = ByteBuffer.allocate(11 + values.size() * 4);
    buffer.put((byte) 1).putLong(tick).putShort((short) values.size());
    for (var value : values) {
      if (!Double.isFinite(value) || value < -1 || value > 1)
        throw new IllegalArgumentException("invalid normalized observation");
      buffer.putFloat(value.floatValue());
    }
    return buffer.array();
  }
}
