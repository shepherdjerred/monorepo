package com.shepherdjerred.thestorm.arena.testing;

import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;

/** A clock tests move by hand. */
public final class FakeClock implements InstantSource {

  private Instant now;

  public FakeClock(Instant start) {
    this.now = start;
  }

  @Override
  public Instant instant() {
    return now;
  }

  public void advance(Duration by) {
    now = now.plus(by);
  }
}
