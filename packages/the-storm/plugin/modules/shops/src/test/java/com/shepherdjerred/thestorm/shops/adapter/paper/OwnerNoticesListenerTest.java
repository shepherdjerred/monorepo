package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.shops.app.ShopStore;
import com.shepherdjerred.thestorm.shops.app.ShopTexts;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeSite;
import java.lang.reflect.Proxy;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import net.kyori.adventure.text.Component;
import org.bukkit.event.player.PlayerJoinEvent;
import org.junit.jupiter.api.Test;

final class OwnerNoticesListenerTest extends ShopsFixture {

  @Test
  void disconnectBeforeTheReadCompletesLeavesTheNoticePending() {
    var owner = player("Alice", 0);
    var pending = new CompletableFuture<List<ShopStore.PendingTrade>>();
    var acknowledgements = new AtomicInteger();
    var store =
        (ShopStore)
            Proxy.newProxyInstance(
                ShopStore.class.getClassLoader(),
                new Class<?>[] {ShopStore.class},
                (_, method, _) ->
                    switch (method.getName()) {
                      case "listUnnotified" -> pending;
                      case "markNotified" -> {
                        acknowledgements.incrementAndGet();
                        yield CompletableFuture.completedFuture(1);
                      }
                      default -> throw new UnsupportedOperationException(method.getName());
                    });
    var replies =
        new Replies(
            server,
            Runnable::run,
            plugin.getComponentLogger(),
            new ShopTexts(plugin.services.require(CrystalFormatter.class)));
    var listener = new OwnerNoticesListener(server, store, replies, 3);
    listener.onJoin(new PlayerJoinEvent(owner, Component.empty()));
    owner.disconnect();

    pending.complete(
        List.of(
            new ShopStore.PendingTrade(
                1,
                new TradeRecord(
                    new TradeSite.Chest(1, owner.getUniqueId()),
                    UUID.randomUUID(),
                    "Bob",
                    Direction.BUY,
                    "coal",
                    4,
                    20,
                    Instant.EPOCH))));

    assertThat(acknowledgements.get()).isZero();
  }
}
