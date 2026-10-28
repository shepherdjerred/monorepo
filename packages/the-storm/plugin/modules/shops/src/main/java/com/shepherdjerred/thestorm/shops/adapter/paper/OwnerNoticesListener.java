package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.shops.app.ShopStore;
import com.shepherdjerred.thestorm.shops.domain.trade.OwnerSummary;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Server;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

/**
 * Tells chest shop owners about their trades: on the spot when they are online, and in one summary
 * when they next join otherwise.
 */
final class OwnerNoticesListener implements Listener {

  private final Server server;
  private final ShopStore store;
  private final Replies replies;
  private final int summaryLines;
  private final Set<UUID> quiet = new HashSet<>();

  OwnerNoticesListener(Server server, ShopStore store, Replies replies, int summaryLines) {
    this.server = server;
    this.store = store;
    this.replies = replies;
    this.summaryLines = summaryLines;
  }

  /** Turns trade messages off, or back on. Returns true when they are now muted. */
  boolean toggleQuiet(UUID owner) {
    if (!quiet.add(owner)) {
      quiet.remove(owner);
      return false;
    }
    return true;
  }

  boolean tellOwnerIfOnline(UUID owner, TradeRecord trade) {
    if (quiet.contains(owner)) {
      return true;
    }
    var player = server.getPlayer(owner);
    if (player == null) {
      return false;
    }
    player.sendMessage(Replies.info(replies.texts().ownerNotice(trade)));
    return true;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    var owner = event.getPlayer().getUniqueId();
    replies.whenDone(
        store.listUnnotified(owner),
        owner,
        pending -> {
          var player = server.getPlayer(owner);
          if (player == null || !player.isOnline()) {
            return;
          }
          if (quiet.contains(owner)) {
            List<Long> ids = pending.stream().map(ShopStore.PendingTrade::id).toList();
            replies.noticeAcknowledgement(store.markNotified(owner, ids), owner);
            return;
          }
          var summary =
              OwnerSummary.of(
                  pending.stream().map(ShopStore.PendingTrade::trade).toList(), summaryLines);
          if (!summary.isEmpty()) {
            replies
                .texts()
                .summary(summary)
                .forEach(line -> player.sendMessage(Replies.info(line)));
            List<Long> ids = pending.stream().map(ShopStore.PendingTrade::id).toList();
            replies.noticeAcknowledgement(store.markNotified(owner, ids), owner);
          }
        });
  }
}
