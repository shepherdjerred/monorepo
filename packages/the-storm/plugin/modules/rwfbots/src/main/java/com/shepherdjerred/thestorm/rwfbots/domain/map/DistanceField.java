package com.shepherdjerred.thestorm.rwfbots.domain.map;

import java.util.Arrays;

/** The path cost from every node to the nearest of a goal set; infinite where unreachable. */
public final class DistanceField {

  private final float[] distance;

  public DistanceField(float[] distance) {
    this.distance = distance.clone();
  }

  public int size() {
    return distance.length;
  }

  public float at(int node) {
    return distance[node];
  }

  public boolean reachable(int node) {
    return Float.isFinite(distance[node]);
  }

  float[] values() {
    return distance.clone();
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof DistanceField that && Arrays.equals(distance, that.distance);
  }

  @Override
  public int hashCode() {
    return Arrays.hashCode(distance);
  }

  @Override
  public String toString() {
    return "DistanceField[" + distance.length + " nodes]";
  }
}
