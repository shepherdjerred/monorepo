package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.game.GameError;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent;
import com.shepherdjerred.thestorm.arena.domain.game.Member;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;

/** Shared admission, protection and recovery contract for both arena modes. */
interface ArenaRunner {
  String id();

  ArenaWorld world();

  Collection<Member> members();

  boolean running();

  Optional<Member> member(UUID player);

  boolean isFighter(UUID player);

  Optional<GameError> handle(GameEvent event);

  void tick();

  boolean awaitsRespawn(UUID player);

  Location exit();

  void respawned(Player player);

  void quitWhileDead(UUID player);

  void announce(com.shepherdjerred.thestorm.arena.domain.game.Notice notice);

  default java.util.concurrent.CompletableFuture<Void> prepareStartup() {
    world().cleanUp();
    return java.util.concurrent.CompletableFuture.completedFuture(null);
  }

  /** A curated menu may be opened only by its current owner in this game. */
  default boolean menu(UUID player, Inventory inventory) {
    return false;
  }
}
