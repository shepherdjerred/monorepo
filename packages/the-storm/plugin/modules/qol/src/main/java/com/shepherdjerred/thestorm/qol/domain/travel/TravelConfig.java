package com.shepherdjerred.thestorm.qol.domain.travel;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;

/**
 * {@code plugins/TheStorm/travel.yml}: the travel hub at the main spawn.
 *
 * @param hubWorld the only world with hub portals
 * @param destinations the worlds the hub reaches, in menu order; the first is the primary
 * @param portals walk-in volumes in {@code hubWorld}
 */
public record TravelConfig(
    String hubWorld, List<TravelDestination> destinations, List<TravelPortal> portals) {

  public TravelConfig {
    destinations = List.copyOf(destinations);
    portals = List.copyOf(portals);
    if (hubWorld.isBlank()) {
      throw new IllegalArgumentException("hubWorld must not be blank");
    }
    if (destinations.isEmpty()) {
      throw new IllegalArgumentException("travel destinations must not be empty");
    }
    var ids = new HashSet<String>();
    for (var destination : destinations) {
      if (!ids.add(destination.id())) {
        throw new IllegalArgumentException("travel destination listed twice: " + destination.id());
      }
      if (destination.world().equals(hubWorld) && !destination.random()) {
        throw new IllegalArgumentException("the hub world's spawn is already the hub");
      }
    }
    for (var portal : portals) {
      if (!ids.contains(portal.destination())) {
        throw new IllegalArgumentException("portal to unknown destination " + portal.destination());
      }
    }
    for (var i = 0; i < portals.size(); i++) {
      for (var j = i + 1; j < portals.size(); j++) {
        if (overlap(portals.get(i), portals.get(j))) {
          throw new IllegalArgumentException(
              "portals to "
                  + portals.get(i).destination()
                  + " and "
                  + portals.get(j).destination()
                  + " overlap");
        }
      }
    }
  }

  /** The destination with {@code id}. */
  public Optional<TravelDestination> destination(String id) {
    return destinations.stream().filter(destination -> destination.id().equals(id)).findFirst();
  }

  /** The destination whose portal holds {@code point} in {@code world}, if any. */
  public Optional<TravelDestination> portalAt(String world, HubPoint point) {
    if (!world.equals(hubWorld)) {
      return Optional.empty();
    }
    for (var portal : portals) {
      if (portal.contains(point)) {
        return destination(portal.destination());
      }
    }
    return Optional.empty();
  }

  private static boolean overlap(TravelPortal a, TravelPortal b) {
    return axis(a.from().x(), a.to().x(), b.from().x(), b.to().x())
        && axis(a.from().y(), a.to().y(), b.from().y(), b.to().y())
        && axis(a.from().z(), a.to().z(), b.from().z(), b.to().z());
  }

  private static boolean axis(int a1, int a2, int b1, int b2) {
    return Math.max(Math.min(a1, a2), Math.min(b1, b2))
        <= Math.min(Math.max(a1, a2), Math.max(b1, b2));
  }
}
