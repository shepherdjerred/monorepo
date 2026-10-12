package com.shepherdjerred.thestorm.arena.domain.survival;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Shared construction, personal cargo, repeatable fuel collection and round cooldown. */
public final class PlaneQuest {
  private final Set<String> parts;
  private final Set<String> installed = new HashSet<>();
  private final Map<UUID, String> carried = new HashMap<>();
  private final Set<String> fuel = new HashSet<>();
  private boolean power;
  private boolean flown;
  private int lastDeparture = -1;

  public PlaneQuest(Set<String> parts) {
    if (parts.isEmpty()) throw new IllegalArgumentException("Plane needs authored parts");
    this.parts = Set.copyOf(parts);
  }

  public boolean powered() {
    return power;
  }

  public void power() {
    power = true;
  }

  public int installed() {
    return installed.size();
  }

  public int fuel() {
    return fuel.size();
  }

  public boolean flown() {
    return flown;
  }

  public Optional<String> carried(UUID player) {
    return Optional.ofNullable(carried.get(player));
  }

  public boolean take(UUID player, String part) {
    if (!parts.contains(part) || carried.containsKey(player) || carried.containsValue(part))
      return false;
    if (!flown && (installed.contains(part) || carried.containsValue(part))) return false;
    if (flown && fuel.contains(part)) return false;
    carried.put(player, part);
    return true;
  }

  public boolean install(UUID player) {
    var part = carried.remove(player);
    if (part == null) return false;
    return flown ? fuel.add(part) : installed.add(part);
  }

  public void leave(UUID player) {
    carried.remove(player);
  }

  public boolean ready(int round) {
    return power
        && installed.size() == parts.size()
        && (!flown || (fuel.size() == parts.size() && round > lastDeparture));
  }

  public boolean depart(int round) {
    if (!ready(round)) return false;
    flown = true;
    fuel.clear();
    lastDeparture = round;
    return true;
  }

  public void debugComplete() {
    power = true;
    installed.addAll(parts);
  }
}
