package com.shepherdjerred.thestorm.tickets.domain;

/**
 * Where a reported incident happened, captured so staff can teleport to it.
 *
 * @param world the world name
 * @param x block x
 * @param y block y
 * @param z block z
 */
public record TicketLocation(String world, int x, int y, int z) {
  public TicketLocation {
    if (world.isBlank()) {
      throw new IllegalArgumentException("world must not be blank");
    }
  }
}
