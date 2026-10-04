package com.shepherdjerred.thestorm.rwf.app;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * What a bot provider implements: the {@link BotRoster} contract in app-level terms, so a module
 * outside rwf can supply bots without naming any {@code rwf.domain} type. Wrap it with {@link
 * BotRoster#of} to publish it. Main thread only.
 */
public interface BotBodies {

  /** Chooses up to {@code slots} bots for {@code matchId}; fewer when the roster is short. */
  List<BotHandle> fill(UUID matchId, int slots);

  /** Puts {@code bot}'s entity into the world at {@code at}; {@link #entity} is present after. */
  void spawn(BotHandle bot, Location at);

  /** Removes {@code bot}'s entity from the world. Despawning an absent bot is harmless. */
  void despawn(BotHandle bot);

  /** The player entity embodying {@code bot}, while spawned. */
  Optional<Player> entity(BotHandle bot);

  /** Whether {@code entity} is one of this provider's bots. */
  boolean isBot(UUID entity);
}
