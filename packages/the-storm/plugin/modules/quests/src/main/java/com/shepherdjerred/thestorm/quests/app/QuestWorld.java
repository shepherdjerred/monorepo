package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.quests.domain.engine.Facts;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Action.NpcMark;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Region;
import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;

/**
 * The server as the quest service sees it; the Paper adapter implements it. Main thread. Every
 * method does nothing for a player who is offline or outside the configured main world.
 */
public interface QuestWorld {

  /** What the world says about {@code player}, or empty if they are offline. */
  Optional<Facts> facts(UUID player);

  /** The online player, for custom actions other modules registered. */
  Optional<Player> player(UUID player);

  /** Gives items, dropping what does not fit at the player's feet. */
  void give(UUID player, ItemMatch item, int amount);

  /** Takes up to {@code amount} matching items. */
  void take(UUID player, ItemMatch item, int amount);

  /** Teleports to the centre of {@code region} if protection lets the player arrive there. */
  void teleport(UUID player, Region region);

  /** Spawns creatures at {@code region}'s centre that despawn after the configured time. */
  void spawn(UUID player, Action.Spawn spawn, Region region);

  /** Sends a chat message. */
  void send(UUID player, Component message);

  /** Shows a line above the hotbar. */
  void actionBar(UUID player, Component message);

  /** Shows these markers to the player above the NPCs. */
  void markers(UUID player, Map<String, NpcMark> marks);

  /** Shows the tracking sidebar, or removes it. */
  void sidebar(UUID player, Optional<Journal.Sidebar> sidebar);
}
