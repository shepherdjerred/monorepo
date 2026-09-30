package com.shepherdjerred.thestorm.quests.adapter.paper;

import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.entity.Player;

/** Shows the tracking sidebar. The real one is a scoreboard; tests record instead. Main thread. */
interface SidebarDisplay {

  /** Shows {@code sidebar} to {@code player}, or removes it when empty. */
  void show(Player player, Optional<Journal.Sidebar> sidebar);

  /** Forgets {@code player} (they quit). */
  void forget(UUID player);
}
