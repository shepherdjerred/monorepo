package com.shepherdjerred.thestorm.qol.domain.travel;

/**
 * One world the hub reaches.
 *
 * @param id the stable id portals refer to
 * @param label the button and message name
 * @param description the line under the button
 * @param world the destination world name
 * @param arrival {@code rtp} for a wilderness landing, or {@code spawn} for the world's spawn
 */
public record TravelDestination(
    String id, String label, String description, String world, String arrival) {

  public TravelDestination {
    if (!id.matches("[a-z0-9_]+")) {
      throw new IllegalArgumentException("bad travel destination id: " + id);
    }
    if (label.isBlank() || description.isBlank() || world.isBlank()) {
      throw new IllegalArgumentException("travel destination " + id + " needs a label and world");
    }
    if (!arrival.equals("rtp") && !arrival.equals("spawn")) {
      throw new IllegalArgumentException("unknown travel arrival for " + id + ": " + arrival);
    }
  }

  /** Whether arrival is a random wilderness landing. */
  public boolean random() {
    return arrival.equals("rtp");
  }
}
