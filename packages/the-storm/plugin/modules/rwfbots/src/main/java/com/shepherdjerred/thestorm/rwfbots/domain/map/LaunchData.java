package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import java.util.Arrays;
import java.util.Optional;
import java.util.stream.IntStream;

/** Sparse, versioned launch requirements aligned to only the sprint-jump edges of a baked graph. */
public final class LaunchData {
  public static final float RUN_UP = 2;
  public static final float MINIMUM_SPEED = 0.27f;
  public static final float TAKEOFF_OFFSET = 0.2f;
  private final int[] edges;
  private final float[] runUp;
  private final float[] speed;
  private final float[] offset;

  public LaunchData(int[] edges, float[] runUp, float[] speed, float[] offset) {
    this.edges = edges.clone();
    this.runUp = runUp.clone();
    this.speed = speed.clone();
    this.offset = offset.clone();
    if (edges.length != runUp.length
        || edges.length != speed.length
        || edges.length != offset.length)
      throw new IllegalArgumentException("launch arrays must align");
    for (var index = 0; index < edges.length; index++) {
      if (edges[index] < 0
          || (index > 0 && edges[index - 1] >= edges[index])
          || !Float.isFinite(runUp[index])
          || runUp[index] < 0.5
          || !Float.isFinite(speed[index])
          || speed[index] <= 0
          || !Float.isFinite(offset[index])
          || offset[index] < 0
          || offset[index] > 0.3) throw new IllegalArgumentException("invalid launch requirement");
    }
  }

  /** Explicit standard primitive requirements for synthetic weighted graphs. */
  public static LaunchData standard(byte[] hops) {
    var edges =
        IntStream.range(0, hops.length)
            .filter(edge -> Hop.ofCode(hops[edge]) == Hop.LEAP)
            .toArray();
    var runUp = new float[edges.length];
    var speed = new float[edges.length];
    var offset = new float[edges.length];
    Arrays.fill(runUp, RUN_UP);
    Arrays.fill(speed, MINIMUM_SPEED);
    Arrays.fill(offset, TAKEOFF_OFFSET);
    return new LaunchData(edges, runUp, speed, offset);
  }

  public int[] edges() {
    return edges.clone();
  }

  public float[] runUp() {
    return runUp.clone();
  }

  public float[] speed() {
    return speed.clone();
  }

  public float[] offset() {
    return offset.clone();
  }

  public void validate(byte[] hops) {
    var expected = 0;
    for (var edge = 0; edge < hops.length; edge++) {
      if (Hop.ofCode(hops[edge]) != Hop.LEAP) continue;
      if (expected >= edges.length || edges[expected] != edge)
        throw new IllegalArgumentException("sprint-jump edge is missing launch requirements");
      expected++;
    }
    if (expected != edges.length)
      throw new IllegalArgumentException("launch metadata names a non-jump edge");
  }

  public Optional<JumpLaunch> launch(int edge, Vec3 from, Vec3 to, double durationTicks) {
    var index = Arrays.binarySearch(edges, edge);
    if (index < 0) return Optional.empty();
    var direction = to.minus(from).horizontal().normalized();
    var takeoff = from.plus(direction.scale(offset[index]));
    return Optional.of(
        new JumpLaunch(
            takeoff, takeoff.minus(direction.scale(runUp[index])), speed[index], durationTicks));
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof LaunchData that
        && Arrays.equals(edges, that.edges)
        && Arrays.equals(runUp, that.runUp)
        && Arrays.equals(speed, that.speed)
        && Arrays.equals(offset, that.offset);
  }

  @Override
  public int hashCode() {
    return Arrays.hashCode(edges);
  }
}
