package com.shepherdjerred.thestorm.economy.adapter.paper;

import com.shepherdjerred.thestorm.economy.app.LedgerWallets;
import com.shepherdjerred.thestorm.economy.app.SeenPlayer;
import com.shepherdjerred.thestorm.economy.domain.CrystalFormat;
import org.bukkit.Server;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

/**
 * Records every join, with the name joined under, and pays the starting balance on a player's first
 * join. The ledger remembers who it has seen, so this runs on every join and pays once.
 */
public final class FirstJoinListener implements Listener {

  private final LedgerWallets wallets;
  private final CrystalFormat format;
  private final Server server;
  private final Replies replies;

  FirstJoinListener(LedgerWallets wallets, CrystalFormat format, Server server, Replies replies) {
    this.wallets = wallets;
    this.format = format;
    this.server = server;
    this.replies = replies;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    var player = event.getPlayer();
    var uuid = player.getUniqueId();
    replies.whenDone(
        wallets.welcome(new SeenPlayer(uuid, player.getName())),
        player,
        granted ->
            granted.ifPresent(
                receipt -> {
                  var online = server.getPlayer(uuid);
                  if (online != null) {
                    online.sendMessage(
                        Replies.success(
                            "Welcome! You start with " + format.words(receipt.amount()) + "."));
                  }
                }));
  }
}
