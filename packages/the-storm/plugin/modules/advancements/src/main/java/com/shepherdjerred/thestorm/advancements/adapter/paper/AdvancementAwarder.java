package com.shepherdjerred.thestorm.advancements.adapter.paper;

import com.shepherdjerred.thestorm.advancements.domain.Catalog;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.GameRules;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;

/**
 * Grants catalog advancements on the main thread. A milestone just reached is announced. One the
 * player already had is filled in without a chat line or a Discord post.
 */
public final class AdvancementAwarder implements Listener {

  private final Server server;

  /**
   * False while {@link #catchUp} is awarding. Paper announces whatever message survives the event,
   * so catch-up clears it before anyone reads it.
   */
  boolean earnedNow = true;

  public AdvancementAwarder(Server server) {
    this.server = server;
  }

  /** Fails startup when the datapack did not register an advancement from the catalog. */
  public void requireInstalled() {
    var missing = new ArrayList<String>();
    for (var def : Catalog.all()) {
      if (server.getAdvancement(key(def.path())) == null) {
        missing.add(Catalog.NAMESPACE + ":" + def.path());
      }
    }
    if (!missing.isEmpty()) {
      throw new IllegalStateException("The Storm advancements are not loaded: " + missing);
    }
  }

  /** Announces milestones just reached. A repeat grant does nothing. */
  public void grant(Player player, List<String> paths) {
    grant(player, paths, true);
  }

  /** Fills in milestones already reached, without a chat or Discord announcement. */
  public void catchUp(Player player, List<String> paths) {
    grant(player, paths, false);
  }

  private void grant(Player player, List<String> paths, boolean earnedNow) {
    if (!Humans.isHuman(player) || !player.isOnline() || paths.isEmpty()) {
      return;
    }
    var previous = this.earnedNow;
    this.earnedNow = earnedNow;
    try {
      for (var path : paths) {
        var advancement = server.getAdvancement(key(path));
        if (advancement == null) {
          throw new IllegalStateException("missing advancement " + Catalog.NAMESPACE + ":" + path);
        }
        var progress = player.getAdvancementProgress(advancement);
        if (progress.isDone()) {
          continue;
        }
        if (!progress.awardCriteria("done")) {
          throw new IllegalStateException(
              "could not award " + Catalog.NAMESPACE + ":" + path + " to " + player.getUniqueId());
        }
      }
    } finally {
      this.earnedNow = previous;
    }
  }

  /** Catch-up grants drop the chat line before Discord or the broadcaster can see it. */
  @EventHandler(priority = EventPriority.LOWEST)
  void quietCatchUp(PlayerAdvancementDoneEvent event) {
    if (!earnedNow) {
      event.message(null);
    }
  }

  /** Worlds that hide advancement chat, such as Search and Destroy, still say a Storm milestone. */
  @EventHandler(priority = EventPriority.MONITOR)
  void showWhereChatIsHidden(PlayerAdvancementDoneEvent event) {
    var message = event.message();
    if (message == null
        || !earnedNow
        || !Humans.isHuman(event.getPlayer())
        || PlayerVisibility.hidden(event.getPlayer())
        || !Catalog.NAMESPACE.equals(event.getAdvancement().getKey().getNamespace())) {
      return;
    }
    var shown = event.getPlayer().getWorld().getGameRuleValue(GameRules.SHOW_ADVANCEMENT_MESSAGES);
    if (!Boolean.FALSE.equals(shown)) {
      return;
    }
    var _ = event.getPlayer().getServer().broadcast(message);
  }

  private static NamespacedKey key(String path) {
    var key = NamespacedKey.fromString(Catalog.NAMESPACE + ":" + path);
    if (key == null) {
      throw new IllegalStateException("advancement id: " + path);
    }
    return key;
  }
}
