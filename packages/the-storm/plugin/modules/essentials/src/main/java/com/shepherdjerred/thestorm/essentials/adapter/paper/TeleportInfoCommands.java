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
        "Teleport rules, current prices and shared cooldown");
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
    var rules = status.rules();
    var active = status.history().active(rules.window(), status.now());
    var points = active.stream().mapToLong(trip -> trip.halfPoints()).sum() / 2.0;
    Say.info(
        player,
        Say.TELEPORT,
        "Occasional travel is affordable. Use elytra, happy ghasts and paths for regular journeys.");
    Say.info(
        player,
        Say.TELEPORT,
        "All travel commands share "
            + rules.allowance()
            + " points over the last "
            + DurationText.format(rules.window())
            + ". You have used "
            + points
            + ".");
    Say.info(
        player,
        Say.TELEPORT,
        "Each extra point (including your next trip) doubles price and cooldown, capped at x"
            + number(rules.maxMultiplier())
            + ". Each completed trip stops counting after "
            + DurationText.format(rules.window())
            + ".");
    if (status.now().isBefore(status.history().cooldownUntil())) {
      Say.info(
          player,
          Say.TELEPORT,
          "Shared cooldown remaining: "
              + DurationText.format(
                  Duration.between(status.now(), status.history().cooldownUntil()))
              + ".");
    } else {
      Say.info(player, Say.TELEPORT, "Shared cooldown: ready.");
    }
    active.stream()
        .map(trip -> trip.at().plus(rules.window()))
        .min(java.time.Instant::compareTo)
        .ifPresent(
            at ->
                Say.info(
                    player,
                    Say.TELEPORT,
                    "Next usage expires in "
                        + DurationText.format(Duration.between(status.now(), at))
                        + "."));
    for (var kind : TeleportKind.values()) {
      if (selected.isEmpty() || selected.orElseThrow() == kind) {
        line(player, status, kind);
      }
    }
    if (status.now().isBefore(status.rtpFreeUntil())) {
      Say.info(
          player,
          Say.TELEPORT,
          "RTP is free for another "
              + DurationText.format(Duration.between(status.now(), status.rtpFreeUntil()))
              + "; its points and escalating cooldown still apply.");
    }
  }

  private static void line(Player player, TeleportTravel.Status status, TeleportKind kind) {
    var base = status.rules().prices().of(kind);
    var quote = status.quote(kind);
    Say.info(
        player,
        Say.TELEPORT,
        usage(kind)
            + ": "
            + base.weight()
            + " points; base "
            + base.cost()
            + " crystals / "
            + DurationText.format(base.cooldown())
            + "; now "
            + quote.cost()
            + " crystals / "
            + DurationText.format(quote.cooldown())
            + " ("
            + quote.multiplier()
            + ").");
    if (kind == TeleportKind.TPA) {
      Say.info(
          player,
          Say.TELEPORT,
          "The requester pays and uses the allowance after /tpaccept. An unanswered request costs nothing.");
    }
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

  private static String number(double value) {
    return java.math.BigDecimal.valueOf(value).stripTrailingZeros().toPlainString();
  }
}
