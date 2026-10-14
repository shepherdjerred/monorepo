package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.adapter.content.RwfConfig;
import com.shepherdjerred.thestorm.rwf.app.BotDifficulty;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.UUID;
import org.bukkit.entity.Player;

/** Validates the current host's settings interactions against the live lobby session. */
final class LobbySettings {
  private final MatchRunner runner;
  private final PaperContext context;
  private final RwfConfig config;

  LobbySettings(MatchRunner runner, PaperContext context, RwfConfig config) {
    this.runner = runner;
    this.context = context;
    this.config = config;
  }

  void hostChanged(Optional<UUID> previous) {
    var host = runner.session().host();
    if (previous.equals(host)) return;
    host.flatMap(runner::memberOf)
        .ifPresent(
            member ->
                runner
                    .humanEntities()
                    .forEach(
                        player ->
                            Texts.info(
                                player,
                                member.name()
                                    + " is the host. Open Match settings with the comparator.")));
  }

  void open(Player player) {
    var session = runner.session();
    if (!runner.features().hostSettings() || runner.memberOf(player.getUniqueId()).isEmpty()) {
      return;
    }
    var host =
        session.host().flatMap(runner::memberOf).map(Combatant::name).orElse("Waiting for players");
    SettingsMenu.open(
        context.server(),
        player,
        new SettingsMenu.View(
            session.selected(), host, session.hosts(player.getUniqueId()), session.locked()));
  }

  void change(Player player, int slot, int step) {
    var session = runner.session();
    if (!runner.features().hostSettings()
        || !player.isOnline()
        || runner.memberOf(player.getUniqueId()).isEmpty()) {
      return;
    }
    if (!session.hosts(player.getUniqueId())) {
      Texts.info(player, "Only the host can change settings.");
      open(player);
      return;
    }
    var options = session.selected();
    var next =
        switch (slot) {
          case SettingsMenu.AUTO -> options.withCount(OptionalInt.empty());
          case SettingsMenu.OFF -> options.withCount(OptionalInt.of(0));
          case SettingsMenu.LESS, SettingsMenu.MORE -> {
            var base =
                options
                    .count()
                    .orElseGet(
                        () ->
                            runner
                                .match()
                                .map()
                                .map(
                                    map ->
                                        Math.max(
                                            0, runner.lobbySizes().target(map) - runner.humans()))
                                .orElseGet(
                                    () ->
                                        Math.max(
                                            0,
                                            config.match().targetCombatants() - runner.humans())));
            var count =
                Math.clamp(
                    base + (slot == SettingsMenu.MORE ? step : -step),
                    0,
                    Math.max(0, config.match().maxCombatants() - runner.humans()));
            yield options.withCount(OptionalInt.of(count));
          }
          case SettingsMenu.DIFFICULTY -> {
            yield options.withDifficulty(
                switch (options.difficulty()) {
                  case EASY -> BotDifficulty.NORMAL;
                  case NORMAL -> BotDifficulty.HARD;
                  case HARD -> BotDifficulty.EASY;
                });
          }
          default -> options;
        };
    if (!next.equals(options) && session.select(player.getUniqueId(), next)) {
      Texts.info(
          player,
          session.locked()
              ? "Settings saved for the next round."
              : "Settings saved for this round.");
    }
    open(player);
  }
}
