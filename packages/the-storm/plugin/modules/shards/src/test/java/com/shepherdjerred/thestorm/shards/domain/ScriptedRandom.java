package com.shepherdjerred.thestorm.shards.domain;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.random.RandomGenerator;

/** A random source that returns scripted doubles and ints, and fails on anything unscripted. */
final class ScriptedRandom implements RandomGenerator {

  private final Deque<Double> doubles = new ArrayDeque<>();
  private final Deque<Integer> ints = new ArrayDeque<>();

  static ScriptedRandom rolls(double... values) {
    var random = new ScriptedRandom();
    for (var value : values) {
      random.doubles.add(value);
    }
    return random;
  }

  ScriptedRandom thenInt(int value) {
    ints.add(value);
    return this;
  }

  boolean exhausted() {
    return doubles.isEmpty() && ints.isEmpty();
  }

  @Override
  public double nextDouble() {
    var value = doubles.poll();
    if (value == null) {
      throw new AssertionError("unexpected nextDouble()");
    }
    return value;
  }

  @Override
  public int nextInt(int origin, int bound) {
    var value = ints.poll();
    if (value == null) {
      throw new AssertionError("unexpected nextInt(" + origin + ", " + bound + ")");
    }
    if (value < origin || value >= bound) {
      throw new AssertionError(value + " is outside [" + origin + ", " + bound + ")");
    }
    return value;
  }

  @Override
  public long nextLong() {
    throw new AssertionError("unexpected nextLong()");
  }
}
