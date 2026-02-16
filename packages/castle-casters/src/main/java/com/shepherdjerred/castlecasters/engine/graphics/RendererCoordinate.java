package com.shepherdjerred.castlecasters.engine.graphics;

import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.ToString;

@Getter
@ToString
@EqualsAndHashCode
public class RendererCoordinate {

  private final float x;
  private final float y;
  private final float z;

  public RendererCoordinate(float x, float y) {
    this.x = x;
    this.y = y;
    this.z = 0;
  }

  public RendererCoordinate(float x, float y, float z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}
