package com.shepherdjerred.castlecasters.engine.graphics;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.ToString;

@Getter
@ToString
@AllArgsConstructor
public class Color {

  private final float red;
  private final float blue;
  private final float green;
  private final float alpha;

  public Color(float red, float blue, float green) {
    this.red = red;
    this.blue = blue;
    this.green = green;
    this.alpha = 1;
  }

  public static Color white() {
    return new Color(1, 1, 1);
  }

  public static Color black() {
    return new Color(0, 0, 0);
  }

  public float[] toRgbFloatArray() {
    return new float[]{red, blue, green};
  }
}
