package com.shepherdjerred.thestorm.rwfbots.domain.map;

import java.util.Arrays;
import java.util.stream.IntStream;

/** Compact conservative fall risks and sparse sprint-jump requirements, aligned to graph edges. */
public final class EdgeCapabilities {
  private final byte[] damage;
  private final LaunchData launch;
  private final DamageOverflow overflow;

  public EdgeCapabilities(byte[] damage, LaunchData launch) {
    this(damage, new DamageOverflow(new int[0], new int[0]), launch);
  }

  public EdgeCapabilities(int[] damage, LaunchData launch) {
    this(pack(damage), overflow(damage), launch);
  }

  public EdgeCapabilities(byte[] damage, DamageOverflow overflow, LaunchData launch) {
    this.damage = damage.clone();
    this.launch = launch;
    this.overflow = overflow;
    overflow.validate(this.damage);
  }

  private static byte[] pack(int[] damage) {
    var packed = new byte[damage.length];
    for (var edge = 0; edge < damage.length; edge++) {
      if (damage[edge] < 0) throw new IllegalArgumentException("negative edge damage");
      packed[edge] = (byte) Math.min(255, damage[edge]);
    }
    return packed;
  }

  private static DamageOverflow overflow(int[] damage) {
    var edges = IntStream.range(0, damage.length).filter(edge -> damage[edge] > 255).toArray();
    return new DamageOverflow(edges, IntStream.of(edges).map(edge -> damage[edge]).toArray());
  }

  public DamageOverflow overflow() {
    return overflow;
  }

  public static EdgeCapabilities standard(byte[] hops) {
    return new EdgeCapabilities(new byte[hops.length], LaunchData.standard(hops));
  }

  public byte[] damage() {
    return damage.clone();
  }

  public LaunchData launch() {
    return launch;
  }

  public int damage(int edge) {
    var value = Byte.toUnsignedInt(damage[edge]);
    return value == 255 ? overflow.damage(edge) : value;
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof EdgeCapabilities that
        && Arrays.equals(damage, that.damage)
        && overflow.equals(that.overflow)
        && launch.equals(that.launch);
  }

  @Override
  public int hashCode() {
    return 31 * Arrays.hashCode(damage) + launch.hashCode() + overflow.hashCode();
  }
}
