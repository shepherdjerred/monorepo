package com.shepherdjerred.thestorm.rwfbots.app.learning;

import java.util.Arrays;

/** Immutable finite row-major float32 tensor, copied at every ownership boundary. */
public final class ActorMatrix {
  private final int rows;
  private final int columns;
  private final float[] values;

  public ActorMatrix(int rows, int columns, float[] values) {
    if (rows < 1 || rows > 100 || columns < 1 || values.length != rows * columns)
      throw new IllegalArgumentException("invalid actor matrix shape");
    for (var value : values) {
      if (!Float.isFinite(value)) throw new IllegalArgumentException("nonfinite actor tensor");
    }
    this.rows = rows;
    this.columns = columns;
    this.values = values.clone();
  }

  public int rows() {
    return rows;
  }

  public int columns() {
    return columns;
  }

  public float[] values() {
    return values.clone();
  }

  public float[] row(int index) {
    if (index < 0 || index >= rows) throw new IllegalArgumentException("actor row out of bounds");
    return Arrays.copyOfRange(values, index * columns, (index + 1) * columns);
  }
}
