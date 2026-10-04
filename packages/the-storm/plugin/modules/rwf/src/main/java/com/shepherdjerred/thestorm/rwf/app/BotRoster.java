package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * Bots that fill a match. Declared here and provided by the rwfbots module; rwf looks it up lazily
 * with {@code services().find(BotRoster.class)} when a countdown starts, and runs humans-only
 * matches when no provider is enabled. Bot combatants are {@link Player} instances (Citizens NPCs):
 * listeners treat them like players, the match never pays them, and they act only through {@link
 * CombatantActions}. Main thread only.
 */
public interface BotRoster {

  /** Chooses up to {@code slots} bots for {@code matchId}; fewer when the roster is short. */
  List<CombatantId.Bot> fill(UUID matchId, int slots);

  /**
   * Puts {@code id}'s entity into the world at {@code at}; {@link #entity} is present afterwards.
   */
  void spawn(CombatantId.Bot id, Location at);

  /** Removes {@code id}'s entity from the world. Despawning an absent bot is harmless. */
  void despawn(CombatantId.Bot id);

  /** The player entity embodying {@code id}, while spawned. */
  Optional<Player> entity(CombatantId.Bot id);

  /** Whether {@code entity} is one of this roster's bots. */
  boolean isBot(UUID entity);
}
