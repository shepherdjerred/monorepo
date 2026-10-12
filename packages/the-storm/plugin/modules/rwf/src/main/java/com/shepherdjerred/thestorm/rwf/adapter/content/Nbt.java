package com.shepherdjerred.thestorm.rwf.adapter.content;

import java.io.DataInput;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A minimal reader for the named binary tag format, enough for a Sponge schematic: every tag type
 * is decoded into plain Java values (compounds become maps, lists become lists), with a size cap so
 * a corrupt file cannot allocate without bound.
 */
final class Nbt {

  /** No single array or string in a schematic is larger than this. */
  static final int MAX_LENGTH = 64 << 20;

  static final byte END = 0;
  static final byte BYTE = 1;
  static final byte SHORT = 2;
  static final byte INT = 3;
  static final byte LONG = 4;
  static final byte FLOAT = 5;
  static final byte DOUBLE = 6;
  static final byte BYTE_ARRAY = 7;
  static final byte STRING = 8;
  static final byte LIST = 9;
  static final byte COMPOUND = 10;
  static final byte INT_ARRAY = 11;
  static final byte LONG_ARRAY = 12;

  private Nbt() {}

  /**
   * Reads the root compound; its name is ignored.
   *
   * @throws IOException on a truncated or malformed stream
   */
  static Map<String, Object> readRoot(DataInput in) throws IOException {
    var type = in.readByte();
    if (type != COMPOUND) {
      throw new IOException("root tag is not a compound: type " + type);
    }
    var _ = in.readUTF();
    return readCompound(in);
  }

  private static Map<String, Object> readCompound(DataInput in) throws IOException {
    var compound = new LinkedHashMap<String, Object>();
    while (true) {
      var type = in.readByte();
      if (type == END) {
        return compound;
      }
      var name = in.readUTF();
      if (compound.put(name, readPayload(in, type)) != null) {
        throw new IOException("duplicate tag " + name);
      }
    }
  }

  private static Object readPayload(DataInput in, byte type) throws IOException {
    return switch (type) {
      case BYTE -> in.readByte();
      case SHORT -> in.readShort();
      case INT -> in.readInt();
      case LONG -> in.readLong();
      case FLOAT -> in.readFloat();
      case DOUBLE -> in.readDouble();
      case BYTE_ARRAY -> {
        var bytes = new byte[length(in)];
        in.readFully(bytes);
        yield bytes;
      }
      case STRING -> in.readUTF();
      case LIST -> readList(in);
      case COMPOUND -> readCompound(in);
      case INT_ARRAY -> {
        var ints = new int[length(in)];
        for (var i = 0; i < ints.length; i++) {
          ints[i] = in.readInt();
        }
        yield ints;
      }
      case LONG_ARRAY -> {
        var longs = new long[length(in)];
        for (var i = 0; i < longs.length; i++) {
          longs[i] = in.readLong();
        }
        yield longs;
      }
      default -> throw new IOException("unknown tag type " + type);
    };
  }

  private static List<Object> readList(DataInput in) throws IOException {
    var elementType = in.readByte();
    var size = length(in);
    if (size > 0 && elementType == END) {
      throw new IOException("a non-empty list cannot hold end tags");
    }
    var list = new ArrayList<Object>(Math.min(size, 1024));
    for (var i = 0; i < size; i++) {
      list.add(readPayload(in, elementType));
    }
    return list;
  }

  private static int length(DataInput in) throws IOException {
    var length = in.readInt();
    if (length < 0 || length > MAX_LENGTH) {
      throw new IOException("implausible length " + length);
    }
    return length;
  }
}
