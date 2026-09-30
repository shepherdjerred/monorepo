package com.shepherdjerred.thestorm.qol.testing;

import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;

/** A clock tests move by hand. */
public final class FakeClock implements InstantSource {

  private Instant now;

  public FakeClock(Instant start) {
    this.now = start;
  }

  public static FakeClock at(String instant) {
    return new FakeClock(Instant.parse(instant));
  }

  public void advance(Duration duration) {
    now = now.plus(duration);
  }

  @Override
  public Instant instant() {
    return now;
  }
}
