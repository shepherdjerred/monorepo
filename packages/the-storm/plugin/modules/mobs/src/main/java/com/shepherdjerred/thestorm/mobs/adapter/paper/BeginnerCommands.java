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
    if (!status.enabled()) return "Beginner's luck is off.";
    if (status.active().compareTo(status.normalAfter()) >= 0) return "Beginner's luck has ended.";
    return "Wilderness mobs are gentler for "
        + hours(status.normalAfter().minus(status.active()))
        + " more active hours.";
  }

  private static String hours(Duration duration) {
    return String.format(Locale.ROOT, "%.1f", duration.toMillis() / 3_600_000.0);
  }
}
