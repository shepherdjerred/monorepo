package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;

/** Round information stays visible while short interaction messages take action-bar priority. */
final class SurvivalHud {
  private final SurvivalRunner runner;
  private final BossBar rounds =
      BossBar.bossBar(
          Component.text("Settlement"), 0, BossBar.Color.GREEN, BossBar.Overlay.PROGRESS);
  private final Set<UUID> viewers = new HashSet<>();
  private final Map<UUID, Instant> hints = new HashMap<>();
  private final Map<UUID, org.bukkit.entity.TextDisplay> downed = new HashMap<>();

  SurvivalHud(SurvivalRunner runner) {
    this.runner = runner;
  }

  void hint(Player player, String message, int seconds) {
    hints.put(player.getUniqueId(), runner.context().time().instant().plusSeconds(seconds));
    player.sendActionBar(Component.text(message));
  }

  void tick() {
    var combat = runner.combat();
    var remaining = combat.remaining();
    rounds.name(
        Component.text(
            (runner.game().debug() ? "DEBUG · " : "")
                + "Round "
                + runner.game().round()
                + " · "
                + runner.game().phase()
                + " · "
                + remaining
                + " remaining ("
                + combat.active()
                + " active, "
                + combat.queued()
                + " queued)"));
    rounds.progress(
        (float)
            (combat.total() == 0
                ? 0
                : Math.clamp(1.0 - (double) remaining / combat.total(), 0, 1)));
    for (var player : runner.online()) {
      var id = player.getUniqueId();
      if (viewers.add(id)) player.showBossBar(rounds);
      if (runner.downed(id)) {
        var survivor = runner.game().player(id).orElseThrow();
        var left =
            Math.max(
                0,
                java.time.Duration.between(
                        runner.context().time().instant(), survivor.bleedout().orElseThrow())
                    .toSeconds());
        var label =
            downed.computeIfAbsent(
                id,
                _ -> {
                  var display =
                      player
                          .getWorld()
                          .spawn(
                              Places.at(player).add(0, 2.3, 0),
                              org.bukkit.entity.TextDisplay.class);
                  display.setBillboard(org.bukkit.entity.Display.Billboard.CENTER);
                  display.setPersistent(false);
                  runner.tag(display);
                  return display;
                });
        label.text(
            Component.text(
                player.getName()
                    + " · DOWNED "
                    + left
                    + "s\nHold sneak within 3 blocks · keep line of sight"));
        if (!runner.context().time().instant().isBefore(hints.getOrDefault(id, Instant.MIN)))
          hint(player, "DOWNED " + left + "s · Teammate: hold sneak within 3 blocks", 1);
      } else {
        removeLabel(id);
        if (!runner.context().time().instant().isBefore(hints.getOrDefault(id, Instant.MIN)))
          player.sendActionBar(
              Component.text(
                  runner.items().count(player, org.bukkit.Material.EMERALD)
                      + " emeralds · "
                      + runner.actions().perks(player)
                      + " · "
                      + runner.machines().status(id)));
      }
    }
  }

  private void removeLabel(UUID id) {
    var label = downed.remove(id);
    if (label != null) label.remove();
  }

  void leave(Player player) {
    player.hideBossBar(rounds);
    viewers.remove(player.getUniqueId());
    hints.remove(player.getUniqueId());
    removeLabel(player.getUniqueId());
  }
}
