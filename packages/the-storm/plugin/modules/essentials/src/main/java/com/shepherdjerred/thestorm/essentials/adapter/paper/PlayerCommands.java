package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static io.papermc.paper.command.brigadier.Commands.literal;

import com.shepherdjerred.thestorm.essentials.app.AfkTracker;
import com.shepherdjerred.thestorm.essentials.app.store.KitClaimStore;
import com.shepherdjerred.thestorm.essentials.domain.config.KitSettings;
import io.papermc.paper.command.brigadier.Commands;
import net.kyori.adventure.inventory.Book;
import org.bukkit.entity.Player;

/** {@code /rules} and {@code /afk}; starter supplies are delivered by the join listener. */
final class PlayerCommands {

  private final PaperRuntime runtime;
  private final Book rules;
  private final AfkTracker afk;

  /**
   * The kits players can claim.
   *
   * @param settings the configured kits
   * @param claims when each player last claimed each kit
   * @param deliveries claims whose items are still owed
   */
  record Kits(KitSettings settings, KitClaimStore claims, KitDeliveries deliveries) {}

  PlayerCommands(PaperRuntime runtime, Book rules, AfkTracker afk) {
    this.runtime = runtime;
    this.rules = rules;
    this.afk = afk;
  }

  void register(Commands commands) {
    commands.register(
        literal("rules")
            .requires(Cmd.permission(EssentialsPermissions.RULES))
            .executes(context -> Cmd.asPlayer(context, player -> player.openBook(rules)))
            .build(),
        "Read the server rules");
    commands.register(
        literal("afk")
            .requires(Cmd.permission(EssentialsPermissions.AFK))
            .executes(context -> Cmd.asPlayer(context, this::toggleAfk))
            .build(),
        "Mark yourself away, or back");
  }

  /** Announces that {@code player} is now away or back. */
  void announceAfk(Player player, boolean away) {
    var message = player.getName() + (away ? " is now AFK." : " is no longer AFK.");
    runtime.server().getOnlinePlayers().forEach(online -> Say.info(online, Say.AFK, message));
  }

  private void toggleAfk(Player player) {
    announceAfk(player, afk.toggle(player.getUniqueId()));
  }
}
