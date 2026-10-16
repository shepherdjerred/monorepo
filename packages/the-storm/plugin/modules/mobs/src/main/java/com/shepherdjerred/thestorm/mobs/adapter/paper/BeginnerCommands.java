package com.shepherdjerred.thestorm.mobs.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.mobs.app.BeginnerStatus;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Duration;
import java.util.Locale;
import org.bukkit.entity.Player;

/** Everyone may inspect their own protection; no permission or administrative mutation. */
final class BeginnerCommands {
  private BeginnerCommands() {}

  static void register(ModuleContext context, BeginnerStatus beginner, Commands commands) {
    commands.register(
        Commands.literal("beginnersluck")
            .executes(
                command -> {
                  var sender = command.getSource().getSender();
                  if (!(sender instanceof Player player)) {
                    sender.sendMessage("Only players have beginner's luck.");
                    return 0;
                  }
                  var _ =
                      beginner
                          .status(player.getUniqueId())
                          .whenCompleteAsync(
                              (status, failure) -> {
                                if (!player.isOnline()) return;
                                if (failure != null) {
                                  context.logger().error("Could not read beginner status", failure);
                                  player.sendMessage(
                                      "Your beginner protection is still loading. Try again shortly.");
                                } else player.sendMessage(describe(status));
                              },
                              context.scheduler().mainThread());
                  return 1;
                })
            .build(),
        "Show your beginner protection and active playtime");
  }

  static String describe(BeginnerStatus.Status status) {
    if (!status.enabled())
      return "Beginner's luck is currently disabled. Your saved progress is preserved.";
    if (status.active().compareTo(status.normalAfter()) >= 0)
      return "Beginner's luck complete: "
          + hours(status.active())
          + " active hours played. Wilderness difficulty is normal.";
    var stage =
        status.active().compareTo(status.calmFor()) < 0
            ? "Gentle start; difficulty begins rising in "
                + hours(status.calmFor().minus(status.active()))
                + " active hours."
            : "Difficulty is gradually rising.";
    return "Beginner's luck: "
        + hours(status.active())
        + " active hours played. "
        + stage
        + " You take "
        + Math.round(status.damageMultiplier() * 100)
        + "% of ordinary mob damage. Normal difficulty in "
        + hours(status.normalAfter().minus(status.active()))
        + " active hours. AFK and offline time pause the clock.";
  }

  private static String hours(Duration duration) {
    return String.format(Locale.ROOT, "%.1f", duration.toMillis() / 3_600_000.0);
  }
}
