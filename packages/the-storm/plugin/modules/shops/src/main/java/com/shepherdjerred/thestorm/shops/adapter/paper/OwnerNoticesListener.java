package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.shops.app.OwnerNotices;
import com.shepherdjerred.thestorm.shops.app.ShopStore;
import com.shepherdjerred.thestorm.shops.domain.trade.OwnerSummary;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
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
final class OwnerNoticesListener implements Listener, OwnerNotices {

  private final Server server;
  private final ShopStore store;
  private final Replies replies;
  private final int summaryLines;

  OwnerNoticesListener(Server server, ShopStore store, Replies replies, int summaryLines) {
    this.server = server;
    this.store = store;
    this.replies = replies;
    this.summaryLines = summaryLines;
  }

  @Override
  public boolean tellIfOnline(UUID owner, TradeRecord trade) {
    var player = server.getPlayer(owner);
    if (player == null) {
      return false;
    }
    player.sendMessage(Replies.info(replies.texts().ownerNotice(trade)));
    return true;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    var owner = event.getPlayer().getUniqueId();
    replies.whenDone(
        store.takeUnnotified(owner),
        owner,
        trades -> {
          var summary = OwnerSummary.of(trades, summaryLines);
          if (!summary.isEmpty()) {
            replies
                .texts()
                .summary(summary)
                .forEach(line -> replies.tell(owner, Replies.info(line)));
          }
        });
  }
}
