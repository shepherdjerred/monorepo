package com.shepherdjerred.thestorm.world.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.mojang.brigadier.Command;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.world.app.DailyLedger;
import com.shepherdjerred.thestorm.world.domain.DailyDigestText;
import com.shepherdjerred.thestorm.world.domain.DigestConfig;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.time.InstantSource;
import java.time.LocalDate;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.entity.Player;

/** The crier's on-demand ledger reply, completed on the Paper thread after a database read. */
public final class DailyDigestCommands {

  public record Dependencies(
      DigestConfig config, DailyLedger ledger, InstantSource time, Scheduler scheduler) {}

  private final Dependencies runtime;
  private final ComponentLogger logger;

  public DailyDigestCommands(Dependencies runtime, ComponentLogger logger) {
    this.runtime = runtime;
    this.logger = logger;
  }

  public int announce(CommandSourceStack source) {
    if (!(source.getSender() instanceof Player player)) {
      source.getSender().sendMessage("The daily digest can only be heard in the main world.");
      return Command.SINGLE_SUCCESS;
    }
    if (!player.getWorld().getName().equals(runtime.config().world())) {
      player.sendMessage(
          Component.text("Visit the main world to hear the daily digest.", NamedTextColor.GRAY));
      return Command.SINGLE_SUCCESS;
    }
    var date = LocalDate.ofInstant(runtime.time().instant(), runtime.config().zone());
    var _ =
        runtime
            .ledger()
            .read(date)
            .whenCompleteAsync(
                (recorded, error) -> {
                  if (!player.isOnline()
                      || !player.getWorld().getName().equals(runtime.config().world())) {
                    return;
                  }
                  if (error != null) {
                    logger.error("Could not read main-world daily digest for {}", date, error);
                    player.sendMessage(
                        Component.text("The crier's ledger is unavailable.", NamedTextColor.RED));
                    return;
                  }
                  var world = player.getWorld();
                  var online =
                      Math.toIntExact(
                          player.getServer().getOnlinePlayers().stream()
                              .filter(
                                  other ->
                                      other.getWorld().getName().equals(runtime.config().world()))
                              .count());
                  var view =
                      new DailyDigestText.View(
                          date,
                          requireNonNull(recorded, "successful daily digest read has no result"),
                          new DailyDigestText.WorldNow(
                              online, world.hasStorm(), world.isThundering()),
                          runtime.config().zone());
                  for (var line : DailyDigestText.lines(view)) {
                    player.sendMessage(Component.text(line, NamedTextColor.GOLD));
                  }
                },
                runtime.scheduler().mainThread());
    return Command.SINGLE_SUCCESS;
  }
}
