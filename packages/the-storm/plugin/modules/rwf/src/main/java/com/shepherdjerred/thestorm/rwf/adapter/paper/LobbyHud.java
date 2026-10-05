package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyStatus;
import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/**
 * What a human in the lobby sees of the countdown: one boss bar shared by everyone waiting, saying
 * how many more players the match waits for or how long until it starts, and a title for each of
 * the last five seconds and for the start. The bar is shown on entering the lobby and taken away on
 * leaving, when the match goes live and when it ends. Main thread only.
 */
final class LobbyHud {

  /** The seconds that get a title as the countdown ends. */
  static final int TITLE_FROM = 5;

  private static final Title.Times SECOND =
      Title.Times.times(Duration.ZERO, Duration.ofMillis(900), Duration.ofMillis(100));
  private static final Title.Times FIGHT =
      Title.Times.times(Duration.ZERO, Duration.ofMillis(1500), Duration.ofMillis(500));

  private final Server server;
  private final BossBar bar =
      BossBar.bossBar(
          Component.text("Waiting for players"), 0, BossBar.Color.YELLOW, BossBar.Overlay.PROGRESS);
  private final Set<UUID> viewers = new HashSet<>();

  LobbyHud(Server server) {
    this.server = server;
  }

  /** The shared bar, for tests and diagnostics. */
  BossBar bar() {
    return bar;
  }

  /** Whether {@code player} is shown the bar. */
  boolean showing(Player player) {
    return viewers.contains(player.getUniqueId());
  }

  void show(Player player) {
    viewers.add(player.getUniqueId());
    player.showBossBar(bar);
  }

  void hide(Player player) {
    viewers.remove(player.getUniqueId());
    player.hideBossBar(bar);
  }

  /** Nobody sees the bar any more: the match went live, ended or stopped. */
  void hideAll() {
    for (var id : List.copyOf(viewers)) {
      var player = server.getPlayer(id);
      if (player != null) {
        player.hideBossBar(bar);
      }
    }
    viewers.clear();
  }

  /** Redraws the bar for {@code status}. */
  void update(LobbyStatus status) {
    bar.name(Component.text(text(status)));
    bar.progress((float) status.progress());
    bar.color(
        status.stage() == LobbyStatus.Stage.COUNTDOWN ? BossBar.Color.GREEN : BossBar.Color.YELLOW);
  }

  /** The bar's text for {@code status}. */
  static String text(LobbyStatus status) {
    return switch (status.stage()) {
      case EMPTY -> "Waiting for players";
      case WAITING ->
          "Waiting for "
              + status.needed()
              + (status.needed() == 1 ? " more player" : " more players");
      case COUNTDOWN ->
          "Match starts in "
              + status.secondsLeft()
              + (status.secondsLeft() == 1 ? " second" : " seconds");
      case LIVE -> "Match in progress";
      case ENDED -> "Match over";
      case RESETTING -> "Resetting the map";
    };
  }

  /** {@code seconds} left, as a title, when it is one of the last {@link #TITLE_FROM}. */
  void countdown(List<Player> players, int seconds) {
    if (seconds < 1 || seconds > TITLE_FROM) {
      return;
    }
    var title =
        Title.title(
            Component.text(String.valueOf(seconds), NamedTextColor.YELLOW, TextDecoration.BOLD),
            Component.empty(),
            SECOND);
    players.forEach(player -> player.showTitle(title));
  }

  /** The match has begun. */
  void fight(List<Player> players) {
    var title =
        Title.title(
            Component.text("Fight!", NamedTextColor.RED, TextDecoration.BOLD),
            Component.text("Arm their bomb, defend yours", NamedTextColor.GRAY),
            FIGHT);
    players.forEach(player -> player.showTitle(title));
  }
}
