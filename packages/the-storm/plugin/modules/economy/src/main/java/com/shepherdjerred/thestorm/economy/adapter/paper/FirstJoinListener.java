package com.shepherdjerred.thestorm.economy.adapter.paper;

import com.shepherdjerred.thestorm.economy.app.LedgerWallets;
import com.shepherdjerred.thestorm.economy.app.SeenPlayer;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

/**
 * Records every join and pays the starting balance on a player's first Storm economy join,
 * including players whose vanilla world data predates the economy. The ledger pays once across
 * restarts.
 */
public final class FirstJoinListener implements Listener {

  private final LedgerWallets wallets;
  private final Replies replies;

  FirstJoinListener(LedgerWallets wallets, Replies replies) {
    this.wallets = wallets;
    this.replies = replies;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    var player = event.getPlayer();
    var uuid = player.getUniqueId();
    replies.whenDone(
        wallets.welcome(new SeenPlayer(uuid, player.getName())), player, granted -> {});
  }
}
