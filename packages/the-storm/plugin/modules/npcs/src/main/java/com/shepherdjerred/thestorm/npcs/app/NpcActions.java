package com.shepherdjerred.thestorm.npcs.app;

import java.util.Set;
import org.bukkit.entity.Player;

/**
 * Actions dialogue buttons can run ({@code then: action:<id>}), registered by the modules that own
 * them: the quests module's {@code quests.accept}, a shop's {@code shops.open}, and so on.
 *
 * <p>Ids are namespaced by module ({@code <module>.<name>}). Content is loaded before later modules
 * register their actions, so an unknown id is reported as an error once every module has enabled,
 * and again if a player clicks it.
 */
public interface NpcActions {

  /** Registers {@code action} under {@code id}. Registering an id twice is a wiring bug. */
  void register(String id, NpcAction action);

  /** Every registered id. */
  Set<String> ids();

  /** Something a dialogue button does. Runs on the main thread after the dialog closes. */
  @FunctionalInterface
  interface NpcAction {

    void run(Player player, NpcRef npc);
  }
}
