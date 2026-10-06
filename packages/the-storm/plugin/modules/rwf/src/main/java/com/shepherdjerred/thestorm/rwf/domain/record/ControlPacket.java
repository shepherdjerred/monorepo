package com.shepherdjerred.thestorm.rwf.domain.record;

import java.nio.ByteBuffer;

/** Fixed-width client control sample; source and sequence prevent synthetic or stale labels. */
public record ControlPacket(
    long sequence,
    int keys,
    int yaw,
    int pitch,
    int buttons,
    int slot,
    boolean automated,
    long observationTick) {
  public static final String CHANNEL = "thestorm:rwf_input";
  public static final int BYTES = 29;

  public ControlPacket {
    if (sequence < 0
        || observationTick < -1
        || keys < 0
        || keys > 127
        || yaw < 0
        || yaw >= 36000
        || pitch < -9000
        || pitch > 9000
        || buttons < 0
        || buttons > 3
        || slot < 0
        || slot > 8) {
      throw new IllegalArgumentException("invalid client controls");
    }
  }

  public static ControlPacket decode(byte[] bytes) {
    if (bytes.length != BYTES) throw new IllegalArgumentException("wrong control packet size");
    var buffer = ByteBuffer.wrap(bytes);
    if (buffer.get() != 1) throw new IllegalArgumentException("unknown control packet version");
    var sequence = buffer.getLong();
    var keys = Byte.toUnsignedInt(buffer.get());
    var yaw = buffer.getInt();
    var pitch = buffer.getInt();
    var buttons = Byte.toUnsignedInt(buffer.get());
    var slot = Byte.toUnsignedInt(buffer.get());
    var source = buffer.get();
    if (source != 0 && source != 1) throw new IllegalArgumentException("unknown control source");
    return new ControlPacket(
        sequence, keys, yaw, pitch, buttons, slot, source == 1, buffer.getLong());
  }

  public InputFrame frame(long tick, String pseudonym) {
    return frame(tick, pseudonym, 0);
  }

  public InputFrame frame(long tick, String pseudonym, long liveTick) {
    var observed = observationTick < liveTick ? -1 : observationTick - liveTick;
    return new InputFrame(
        tick,
        pseudonym,
        keys,
        yaw,
        pitch,
        (buttons & 1) != 0,
        (buttons & 2) != 0,
        slot,
        sequence,
        observed,
        automated ? InputFrame.Source.AUTOMATED : InputFrame.Source.HUMAN);
  }
}
