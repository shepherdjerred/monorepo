package com.shepherdjerred.thestorm.qol.domain.travel;

/**
 * A walk-in volume at the hub, inclusive on every axis.
 *
 * @param destination the {@link TravelDestination#id()} it sends players to
 * @param from one corner
 * @param to the opposite corner
 */
public record TravelPortal(String destination, HubPoint from, HubPoint to) {

  private static final int MAX_SPAN = 16;

  public TravelPortal {
    if (span(from.x(), to.x()) > MAX_SPAN
        || span(from.y(), to.y()) > MAX_SPAN
        || span(from.z(), to.z()) > MAX_SPAN) {
      throw new IllegalArgumentException(
          "travel portal to " + destination + " is larger than " + MAX_SPAN + " blocks");
    }
  }

  /** Whether {@code point} is inside this volume. */
  public boolean contains(HubPoint point) {
    return within(point.x(), from.x(), to.x())
        && within(point.y(), from.y(), to.y())
        && within(point.z(), from.z(), to.z());
  }

  private static boolean within(int value, int a, int b) {
    return value >= Math.min(a, b) && value <= Math.max(a, b);
  }

  private static int span(int a, int b) {
    return Math.abs(a - b) + 1;
  }
}
