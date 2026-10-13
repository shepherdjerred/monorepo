package com.shepherdjerred.thestorm.rwfbots.domain.map;

import java.util.Arrays;

/** Sparse wide fall-damage values; ordinary edges retain their single-byte lookup. */
public final class DamageOverflow {
  private final int[] edges;
  private final int[] values;

  public DamageOverflow(int[] edges, int[] values) {
    this.edges = edges.clone();
    this.values = values.clone();
    if (edges.length != values.length)
      throw new IllegalArgumentException("damage overflow arrays differ");
    for (var index = 0; index < edges.length; index++)
      if (edges[index] < 0
          || values[index] <= 255
          || (index > 0 && edges[index - 1] >= edges[index]))
        throw new IllegalArgumentException("invalid sparse wide damage");
  }

  public int[] edges() {
    return edges.clone();
  }

  public int[] values() {
    return values.clone();
  }

  int damage(int edge) {
    var index = Arrays.binarySearch(edges, edge);
    return index < 0 ? 255 : values[index];
  }

  void validate(byte[] damage) {
    for (var edge : edges)
      if (edge >= damage.length || Byte.toUnsignedInt(damage[edge]) != 255)
        throw new IllegalArgumentException("wide damage does not name a saturated edge");
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof DamageOverflow that
        && Arrays.equals(edges, that.edges)
        && Arrays.equals(values, that.values);
  }

  @Override
  public int hashCode() {
    return 31 * Arrays.hashCode(edges) + Arrays.hashCode(values);
  }
}
