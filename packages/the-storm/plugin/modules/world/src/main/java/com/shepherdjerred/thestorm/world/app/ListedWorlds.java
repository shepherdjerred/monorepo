package com.shepherdjerred.thestorm.world.app;

import java.util.List;
import java.util.Optional;

/** {@link WildWorlds} over a fixed list. */
public final class ListedWorlds implements WildWorlds {

  private final List<WildWorld> worlds;

  public ListedWorlds(List<WildWorld> worlds) {
    this.worlds = List.copyOf(worlds);
    if (this.worlds.stream().noneMatch(WildWorld::rtp)) {
      throw new IllegalArgumentException("worlds must include a random-teleport world");
    }
  }

  @Override
  public List<WildWorld> worlds() {
    return worlds;
  }

  @Override
  public Optional<WildWorld> named(String name) {
    for (var world : worlds) {
      if (world.name().equals(name)) {
        return Optional.of(world);
      }
    }
    return Optional.empty();
  }

  @Override
  public WildWorld defaultWorld() {
    for (var world : worlds) {
      if (world.rtp()) {
        return world;
      }
    }
    throw new IllegalStateException("no random-teleport world");
  }
}
