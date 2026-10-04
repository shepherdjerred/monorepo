package com.shepherdjerred.mcbridge.domain;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A box of block states as a palette plus YZX indices. The wire form is base64 of little-endian
 * uint32 palette indices, {@code index = (y*sizeZ + z)*sizeX + x}.
 */
public final class PaletteGrid {
  private final Box box;
  private final int[] indices;
  private final List<String> palette = new ArrayList<>();
  private final Map<String, Integer> paletteIndex = new HashMap<>();

  public PaletteGrid(Box box) {
    box.requireVolumeAtMost(Integer.MAX_VALUE / Integer.BYTES);
    this.box = box;
    this.indices = new int[(int) box.volume()];
  }

  /** Records the state at a world position inside the box. */
  public void set(int x, int y, int z, String state) {
    Integer index = paletteIndex.get(state);
    if (index == null) {
      index = palette.size();
      palette.add(state);
      paletteIndex.put(state, index);
    }
    indices[box.index(x, y, z)] = index;
  }

  public Box box() {
    return box;
  }

  /** The palette in first-seen order. */
  public List<String> palette() {
    return List.copyOf(palette);
  }

  /** The palette index at a world position. */
  public int indexAt(int x, int y, int z) {
    return indices[box.index(x, y, z)];
  }

  /** Base64 of the little-endian uint32 indices. */
  public String encodedIndices() {
    ByteBuffer buffer =
        ByteBuffer.allocate(indices.length * Integer.BYTES).order(ByteOrder.LITTLE_ENDIAN);
    for (int index : indices) {
      buffer.putInt(index);
    }
    return Base64.getEncoder().encodeToString(buffer.array());
  }

  /** Decodes {@link #encodedIndices()} output, for tests and diagnostics. */
  public static int[] decodeIndices(String encoded) {
    ByteBuffer buffer =
        ByteBuffer.wrap(Base64.getDecoder().decode(encoded)).order(ByteOrder.LITTLE_ENDIAN);
    int[] decoded = new int[buffer.remaining() / Integer.BYTES];
    for (int i = 0; i < decoded.length; i++) {
      decoded[i] = buffer.getInt();
    }
    return decoded;
  }
}
