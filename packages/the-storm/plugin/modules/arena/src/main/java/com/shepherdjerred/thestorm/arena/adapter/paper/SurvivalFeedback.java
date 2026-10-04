package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

/** Local interaction cues; repeated clicks cannot produce a sound storm. */
final class SurvivalFeedback {
  enum Cue {
    GATHER(Sound.ENTITY_ITEM_PICKUP, 1.2f),
    CRAFT(Sound.BLOCK_ANVIL_USE, 1.4f),
    CONFIRM(Sound.BLOCK_NOTE_BLOCK_HAT, 1),
    PURCHASE(Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 1.2f),
    FAILURE(Sound.BLOCK_NOTE_BLOCK_BASS, .6f),
    UNLOCK(Sound.BLOCK_IRON_DOOR_OPEN, .7f),
    POWER(Sound.BLOCK_BEACON_ACTIVATE, 1),
    UPGRADE(Sound.BLOCK_ENCHANTMENT_TABLE_USE, .9f),
    ABILITY(Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1.2f);

    private final String sound;
    private final float pitch;

    Cue(Sound sound, float pitch) {
      this.sound = org.bukkit.Registry.SOUND_EVENT.getKeyOrThrow(sound).asString();
      this.pitch = pitch;
    }
  }

  private final SurvivalRunner runner;
  private final Map<UUID, Instant> next = new HashMap<>();

  SurvivalFeedback(SurvivalRunner runner) {
    this.runner = runner;
  }

  void play(Player player, Cue cue) {
    var now = runner.context().time().instant();
    if (now.isBefore(next.getOrDefault(player.getUniqueId(), Instant.MIN))) return;
    next.put(player.getUniqueId(), now.plusMillis(200));
    player.playSound(Places.at(player), cue.sound, .6f, cue.pitch);
  }

  void perk(Player player, com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk perk) {
    var pitches =
        switch (perk) {
          case JUGGERNOG -> new float[] {.7f, .9f, 1.2f};
          case STAMIN_UP -> new float[] {1.2f, 1.5f, 1.8f};
          case DOUBLE_TAP -> new float[] {1, 1, 1.5f};
          case QUICK_REVIVE -> new float[] {.8f, 1.2f, 1};
        };
    for (var i = 0; i < pitches.length; i++) {
      var pitch = pitches[i];
      runner
          .context()
          .scheduler()
          .runOnMainThreadLater(
              java.time.Duration.ofMillis(i * 150L),
              () -> {
                if (player.isOnline() && runner.isFighter(player.getUniqueId()))
                  player.playSound(Places.at(player), Sound.BLOCK_NOTE_BLOCK_PLING, .65f, pitch);
              });
    }
  }

  void leave(UUID id) {
    next.remove(id);
  }

  void animate(
      Player player, com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos pos, Cue cue) {
    var items = runner.items();
    var origin = Places.location(runner.world().world(), pos.center());
    var particle =
        switch (cue) {
          case UNLOCK -> org.bukkit.Particle.WAX_OFF;
          case POWER -> org.bukkit.Particle.ELECTRIC_SPARK;
          case UPGRADE -> org.bukkit.Particle.END_ROD;
          case CRAFT -> org.bukkit.Particle.ENCHANT;
          default -> org.bukkit.Particle.HAPPY_VILLAGER;
        };
    for (var frame = 0; frame < 16; frame++) {
      var angle = frame * Math.PI / 4;
      var radius = .3 + frame / 16.0;
      var at =
          origin
              .clone()
              .add(Math.cos(angle) * radius, .15 + frame / 12.0, Math.sin(angle) * radius);
      runner
          .context()
          .scheduler()
          .runOnMainThreadLater(
              java.time.Duration.ofMillis(frame * 75L),
              () -> {
                if (runner.items() == items && runner.isFighter(player.getUniqueId()))
                  runner.world().world().spawnParticle(particle, at, 3, .1, .1, .1, 0);
              });
    }
  }
}
