package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.rwf.app.BotRoster;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * The bot roster, looked up lazily: the rwfbots module enables after rwf, so the provider is found
 * at the moment bots are wanted, and matches run humans-only while it is absent.
 */
final class Bots {

  private final Services services;

  Bots(Services services) {
    this.services = services;
  }

  Optional<BotRoster> roster() {
    return services.find(BotRoster.class);
  }

  /** Up to {@code slots} bots for {@code matchId}; none without a provider. */
  List<CombatantId.Bot> fill(UUID matchId, int slots) {
    if (slots <= 0) {
      return List.of();
    }
    return roster().map(r -> r.fill(matchId, slots)).orElseGet(List::of);
  }

  /** Spawns {@code bot} at {@code at} and returns its entity. */
  Optional<Player> spawn(CombatantId.Bot bot, Location at) {
    var roster = roster();
    if (roster.isEmpty()) {
      return Optional.empty();
    }
    roster.orElseThrow().spawn(bot, at);
    return roster.orElseThrow().entity(bot);
  }

  void despawn(CombatantId.Bot bot) {
    roster().ifPresent(r -> r.despawn(bot));
  }

  Optional<Player> entity(CombatantId.Bot bot) {
    return roster().flatMap(r -> r.entity(bot));
  }

  boolean isBot(UUID entity) {
    return roster().map(r -> r.isBot(entity)).orElse(false);
  }
}
