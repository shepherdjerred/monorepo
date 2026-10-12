package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.JukeboxSong;
import org.bukkit.Registry;
import org.bukkit.SoundCategory;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;
import org.jspecify.annotations.Nullable;

/** Two landmarks and one nearest native disc per survivor keep ambient feedback bounded. */
final class SurvivalAmbience {
  private record Playing(SurvivalContent.Machine machine, JukeboxSong song, Instant until) {}

  private final SurvivalRunner runner;
  private final Map<UUID, Playing> music = new HashMap<>();
  private @Nullable TextDisplay power;
  private @Nullable TextDisplay box;

  SurvivalAmbience(SurvivalRunner runner) {
    this.runner = runner;
  }

  void tick() {
    if (!runner.running()) return;
    landmarks();
    for (var player : runner.online()) music(player);
    music.keySet().removeIf(id -> runner.context().server().getPlayer(id) == null);
  }

  private void landmarks() {
    var generator =
        runner.map().content().machines().stream()
            .filter(m -> m.type() == SurvivalContent.MachineType.POWER)
            .findFirst()
            .orElseThrow();
    if (power == null || !power.isValid()) power = label(generator.block(), "");
    power.text(
        Component.text(
            runner.machines().powered()
                ? "Generator · POWERED"
                : "Generator · 4 iron + 4 redstone"));
    var active =
        runner.map().content().boxSites().stream()
            .filter(s -> s.id().equals(runner.machines().box().active()))
            .findFirst()
            .orElseThrow();
    var at = Places.location(runner.world().world(), active.block().center()).add(0, 2.7, 0);
    if (box == null || !box.isValid()) box = label(active.block(), "");
    if (box.getLocation().distanceSquared(at) > .01) box.teleport(at);
    box.text(
        Component.text(
            runner.machines().powered()
                ? runner.machines().box().landmark()
                : "Runic cache · needs power"));
  }

  private TextDisplay label(
      com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos at, String text) {
    return runner
        .world()
        .world()
        .spawn(
            Places.location(runner.world().world(), at.center()).add(0, 2, 0),
            TextDisplay.class,
            display -> {
              display.setPersistent(false);
              display.setBillboard(org.bukkit.entity.Display.Billboard.CENTER);
              display.setViewRange(.35f);
              display.setLineWidth(160);
              var transform = display.getTransformation();
              transform.getScale().set(.65f);
              display.setTransformation(transform);
              display.text(Component.text(text));
              runner.tag(display);
            });
  }

  private void music(Player player) {
    var closest =
        runner.map().content().machines().stream()
            .filter(
                m ->
                    switch (m.type()) {
                      case STONEWARD, GALESTRIDE, EMBERWEAVE, SOULBOND -> true;
                      case FOOD, POWER, RUNEFORGE, MYSTERY_BOX -> false;
                    })
            .filter(
                m ->
                    Places.at(player)
                            .distanceSquared(Places.location(player.getWorld(), m.block().center()))
                        <= 144)
            .min(
                java.util.Comparator.comparingDouble(
                    m ->
                        Places.at(player)
                            .distanceSquared(
                                Places.location(player.getWorld(), m.block().center()))));
    var prior = music.get(player.getUniqueId());
    if (!runner.machines().powered()
        || !runner.isFighter(player.getUniqueId())
        || closest.isEmpty()) {
      stop(player);
      return;
    }
    var machine = closest.orElseThrow();
    var now = runner.context().time().instant();
    if (prior != null && prior.machine().equals(machine) && now.isBefore(prior.until())) return;
    stop(player);
    var song =
        switch (SurvivalPerk.valueOf(machine.type().name())) {
          case STONEWARD -> JukeboxSong.RELIC;
          case GALESTRIDE -> JukeboxSong.OTHERSIDE;
          case EMBERWEAVE -> JukeboxSong.PIGSTEP;
          case SOULBOND -> JukeboxSong.CREATOR_MUSIC_BOX;
        };
    player.playSound(
        Places.location(player.getWorld(), machine.block().center()),
        Registry.SOUND_EVENT.getKeyOrThrow(song.getSound()).asString(),
        SoundCategory.RECORDS,
        .3f,
        1);
    music.put(
        player.getUniqueId(),
        new Playing(machine, song, now.plusMillis((long) (song.getLengthInSeconds() * 1000))));
  }

  void stop(Player player) {
    var previous = music.remove(player.getUniqueId());
    if (previous != null) player.stopSound(previous.song().getSound(), SoundCategory.RECORDS);
  }

  void reset() {
    runner.online().forEach(this::stop);
    music.clear();
    if (power != null) power.remove();
    if (box != null) box.remove();
    power = null;
    box = null;
  }
}
