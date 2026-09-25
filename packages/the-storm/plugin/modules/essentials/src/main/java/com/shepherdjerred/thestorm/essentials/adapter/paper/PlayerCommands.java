package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.AfkTracker;
import com.shepherdjerred.thestorm.essentials.app.store.KitClaimStore;
import com.shepherdjerred.thestorm.essentials.domain.config.KitSettings;
import com.shepherdjerred.thestorm.essentials.domain.kit.KitError;
import com.shepherdjerred.thestorm.essentials.domain.place.DurationText;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Instant;
import java.util.List;
import net.kyori.adventure.inventory.Book;
import org.bukkit.entity.Player;

/** {@code /kit}, {@code /rules} and {@code /afk}. */
final class PlayerCommands {

  private final PaperRuntime runtime;
  private final Kits kits;
  private final Book rules;
  private final AfkTracker afk;

  /**
   * The kits players can claim.
   *
   * @param settings the configured kits
   * @param items the kits as item stacks
   * @param claims when each player last claimed each kit
   */
  record Kits(KitSettings settings, KitItems items, KitClaimStore claims) {}

  PlayerCommands(PaperRuntime runtime, Kits kits, Book rules, AfkTracker afk) {
    this.runtime = runtime;
    this.kits = kits;
    this.rules = rules;
    this.afk = afk;
  }

  void register(Commands commands) {
    commands.register(
        literal("kit")
            .requires(Cmd.permission(EssentialsPermissions.KIT))
            .executes(context -> Cmd.asPlayer(context, this::listKits))
            .then(
                argument("name", word())
                    .suggests(Cmd.suggest(() -> kits.settings().kits().keySet()))
                    .executes(
                        context ->
                            Cmd.asPlayer(
                                context, player -> claim(player, Cmd.string(context, "name")))))
            .build(),
        "Claim a kit");
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

  private void listKits(Player player) {
    var available = available(player);
    if (available.isEmpty()) {
      Say.info(player, Say.KITS, "There are no kits for you.");
    } else {
      Say.info(player, Say.KITS, "Kits: " + String.join(", ", available));
    }
  }

  private void claim(Player player, String name) {
    var kit = kits.settings().kits().get(name);
    if (kit == null || !player.hasPermission(EssentialsPermissions.kit(name))) {
      Say.error(player, Say.KITS, "There is no kit called " + name + " for you.");
      return;
    }
    var claim = new KitClaimStore.KitClaim(name, kit, runtime.time().instant());
    runtime.onMain(
        kits.claims().claim(player.getUniqueId(), claim),
        "claiming a kit",
        result -> {
          switch (result) {
            case Result.Ok<Instant, KitError> _ -> {
              if (player.isOnline()) {
                kits.items().give(player, name);
                Say.success(player, Say.KITS, "You received the " + name + " kit.");
              }
            }
            case Result.Err<Instant, KitError>(var error) ->
                Say.error(player, Say.KITS, describe(error));
          }
        });
  }

  private List<String> available(Player player) {
    return kits.settings().kits().keySet().stream()
        .filter(name -> player.hasPermission(EssentialsPermissions.kit(name)))
        .sorted()
        .toList();
  }

  private static String describe(KitError error) {
    return switch (error) {
      case KitError.OnCooldown(var remaining) ->
          "You can claim that kit again in " + DurationText.format(remaining) + ".";
      case KitError.AlreadyClaimed() -> "You have already claimed that kit.";
    };
  }
}
