package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.shepherdjerred.thestorm.essentials.app.TeleportTravel;
import com.shepherdjerred.thestorm.essentials.domain.place.DurationText;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Duration;
import java.util.Locale;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import org.bukkit.entity.Player;

/** Configured rules, personal status and command help without executing a teleport. */
final class TeleportInfoCommands {
  private final PaperRuntime runtime;
  private final TeleportTravel travel;

  TeleportInfoCommands(PaperRuntime runtime, TeleportTravel travel) {
    this.runtime = runtime;
    this.travel = travel;
  }

  void register(Commands commands) {
    commands.register(
        Commands.literal("tpinfo")
            .executes(context -> Cmd.asPlayer(context, player -> show(player, Optional.empty())))
            .then(
                Commands.argument("category", word())
                    .suggests(
                        (context, builder) -> {
                          for (var kind : TeleportKind.values()) {
                            builder.suggest(kind.id());
                          }
                          builder.suggest("tpahere");
                          return builder.buildFuture();
                        })
                    .executes(
                        context ->
                            Cmd.asPlayer(
                                context,
                                player -> category(player, Cmd.string(context, "category")))))
            .build(),
        "Teleport prices and cooldowns");
  }

  private void category(Player player, String name) {
    var normalized = name.toLowerCase(Locale.ROOT);
    var id = normalized.equals("tpahere") ? "tpa" : normalized;
    for (var kind : TeleportKind.values()) {
      if (kind.id().equals(id)) {
        show(player, Optional.of(kind));
        return;
      }
    }
    Say.error(player, Say.TELEPORT, "Use /tpinfo spawn|home|tpa|tpahere|back|warp|rtp.");
  }

  private void show(Player player, Optional<TeleportKind> selected) {
    runtime.onMain(
        travel.status(player),
        "loading teleport information",
        status -> describe(player, status, selected),
        failure ->
            Say.error(
                player, Say.TELEPORT, "Could not load teleport information. Try again later."));
  }

  private static void describe(
      Player player, TeleportTravel.Status status, Optional<TeleportKind> selected) {
    Say.info(
        player,
        Say.TELEPORT,
        "Each command has its own price and cooldown. Elytra, happy ghasts and paths are free.");
    for (var kind : TeleportKind.values()) {
      if (selected.isEmpty() || selected.orElseThrow() == kind) {
        line(player, status, kind);
      }
    }
    if (status.now().isBefore(status.rtpFreeUntil())) {
      Say.info(
          player,
          Say.TELEPORT,
          "Wilderness teleport is free for another "
              + DurationText.format(Duration.between(status.now(), status.rtpFreeUntil()))
              + ".");
    }
  }

  private static void line(Player player, TeleportTravel.Status status, TeleportKind kind) {
    var quote = status.quote(kind);
    var price = quote.cost() == 0 ? "free" : quote.cost() + " crystals";
    var until = status.history().until(kind);
    var ready =
        status.now().isBefore(until)
            ? "ready in " + DurationText.format(Duration.between(status.now(), until))
            : "ready";
    Say.info(
        player,
        Say.TELEPORT,
        usage(kind)
            + ": "
            + price
            + ", "
            + DurationText.format(quote.cooldown())
            + ", "
            + ready
            + ".");
  }

  private static String usage(TeleportKind kind) {
    return switch (kind) {
      case SPAWN -> "/spawn";
      case HOME -> "/home [name] (save with /sethome)";
      case BACK -> "/back";
      case WARP -> "/warp <name>";
      case TPA -> "/tpa <player> or /tpahere <player>";
      case RTP -> "/rtp [world] [biome]";
    };
  }

  static Component help(TeleportKind kind) {
    return Component.text(" [TP rules: /tpinfo " + kind.id() + "]")
        .clickEvent(ClickEvent.runCommand("/tpinfo " + kind.id()));
  }
}
