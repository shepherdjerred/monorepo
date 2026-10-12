package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;

/** Team changes are local; public invitations and milestones have a bounded cadence. */
final class SurvivalAnnouncements {
  private enum Kind {
    LOBBY,
    START,
    MILESTONE,
    END
  }

  private final SurvivalRunner runner;
  private final Map<Kind, Instant> next = new EnumMap<>(Kind.class);
  private boolean lobbyShown;

  SurvivalAnnouncements(SurvivalRunner runner) {
    this.runner = runner;
  }

  void joined(Player player) {
    if (!runner.game().participants().stream().anyMatch(p -> p.id().equals(player.getUniqueId())))
      return;
    runner
        .online()
        .forEach(
            p ->
                Texts.info(
                    p, player.getName() + " joined the lobby. Click the ready block when ready."));
    if (!lobbyShown) {
      lobbyShown = true;
      publicNotice(
          Kind.LOBBY,
          "A " + runner.world().definition().name() + " lobby is forming. ",
          "Join",
          "join");
    }
  }

  void ready(Player player) {
    var ready = runner.game().player(player.getUniqueId()).orElseThrow().ready();
    var status = ready ? " is ready." : " is no longer ready.";
    runner.online().forEach(p -> Texts.info(p, player.getName() + status));
    if (runner.game().phase()
        == com.shepherdjerred.thestorm.arena.domain.survival.SurvivalGame.Phase.COUNTDOWN)
      runner.online().forEach(p -> Texts.info(p, "Everyone is ready · starting in ten seconds."));
  }

  void started() {
    publicNotice(
        Kind.START, runner.world().definition().name() + " has started. ", "Watch", "spec");
  }

  void cleared() {
    if (runner.game().round() % 5 == 0)
      publicNotice(
          Kind.MILESTONE,
          runner.world().definition().name() + " survived round " + runner.game().round() + ". ",
          "Watch",
          "spec");
  }

  void ended() {
    publicNotice(
        Kind.END,
        runner.world().definition().name() + " ended at round " + runner.game().round() + ". ",
        "Join the next run",
        "join");
    runner
        .online()
        .forEach(
            p ->
                Texts.info(
                    p,
                    "Run ended at round "
                        + runner.game().round()
                        + ". Belongings restored; /arena join "
                        + runner.id()
                        + " to play again."));
  }

  private void publicNotice(Kind kind, String message, String action, String command) {
    var now = runner.context().time().instant();
    if (runner.game().debug() || now.isBefore(next.getOrDefault(kind, Instant.MIN))) return;
    next.put(kind, now.plusSeconds(60));
    var link =
        Component.text(action, NamedTextColor.GREEN)
            .clickEvent(ClickEvent.runCommand("/arena " + command + " " + runner.id()));
    var text = Component.text(message).append(link);
    runner.context().server().getOnlinePlayers().forEach(p -> Texts.info(p, text));
  }

  void reset() {
    lobbyShown = false;
  }
}
