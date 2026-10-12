package com.shepherdjerred.thestorm.seasonal;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.discord.app.SeasonalEvent;
import com.shepherdjerred.thestorm.seasonal.adapter.paper.SeasonalDoors;
import com.shepherdjerred.thestorm.seasonal.domain.SeasonalConfig;
import java.time.InstantSource;
import java.time.LocalDate;
import java.time.MonthDay;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

/**
 * Yearly, date-windowed events in the main world, beginning with Stormnight. When the discord
 * module is on, the wake post names the events running.
 */
public final class SeasonalModule implements StormModule {

  private static final DateTimeFormatter UNTIL =
      DateTimeFormatter.ofPattern("MMM d", Locale.ENGLISH);

  @Override
  public String id() {
    return "seasonal";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("seasonal.yml", SeasonalConfig.class);
    var world = context.plugin().getServer().getWorld(config.mainWorld());
    if (world == null) {
      throw new IllegalStateException("Seasonal main world is not loaded: " + config.mainWorld());
    }
    context
        .plugin()
        .getServer()
        .getPluginManager()
        .registerEvents(
            new SeasonalDoors(context.plugin(), config, context.time(), context.random()),
            context.plugin());
    context
        .services()
        .find(DiscordRelay.class)
        .ifPresent(relay -> relay.addSeasonalEvents(() -> running(config, context.time())));
    context.logger().info("Loaded {} seasonal events", config.events().size());
  }

  private static List<SeasonalEvent> running(SeasonalConfig config, InstantSource time) {
    var today = LocalDate.ofInstant(time.instant(), config.zone());
    return config.activeOn(today).stream()
        .map(
            event ->
                new SeasonalEvent(
                    event.title(), UNTIL.format(MonthDay.parse("--" + event.lastDay()))))
        .toList();
  }
}
