// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/TeamBomb.java and
// SearchAndDestroy.java sounds); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.match.SoundCue;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Player;

/**
 * The sounds Red Warfare played, as the rules name them. With the bomb effects on they play at the
 * original volume and pitch: the cues meant for one player (a bomb armed, the fuse warning) play to
 * that player alone, loud enough to be heard anywhere on the map, and the bomb's own ticking and
 * hissing play at the bomb. With them off they play as this server first had them.
 */
final class Sounds {

  /** Red Warfare's volume for the cues heard across the whole map. */
  static final float MAP_WIDE = 10_000;

  private Sounds() {}

  /** {@code cue} at {@code at}, for everyone near it. */
  static void play(World world, Location at, SoundCue cue, boolean original) {
    if (original) {
      switch (cue) {
        case FUSE_TICK -> world.playSound(at, Sound.ENTITY_CREEPER_DEATH, 1.9f, 1.2f);
        case FUSE_HISS -> world.playSound(at, Sound.BLOCK_FIRE_EXTINGUISH, 1, 0);
        case EXPLOSION -> world.playSound(at, Sound.ENTITY_GENERIC_EXPLODE, MAP_WIDE, 0);
        default -> play(world, at, cue, false);
      }
      return;
    }
    switch (cue) {
      case BOMB_ARMED_AGAINST_YOU -> world.playSound(at, Sound.ENTITY_BLAZE_DEATH, 2, 0);
      case BOMB_ARMED_FOR_YOU -> world.playSound(at, Sound.ENTITY_LIGHTNING_BOLT_THUNDER, 2, 1);
      case FUSE_WARNING -> world.playSound(at, Sound.ENTITY_BLAZE_DEATH, 2, 2);
      case FUSE_TICK -> world.playSound(at, Sound.ENTITY_CREEPER_DEATH, 1, 1);
      case FUSE_HISS -> world.playSound(at, Sound.BLOCK_FIRE_EXTINGUISH, 1, 1);
      case EXPLOSION -> world.playSound(at, Sound.ENTITY_GENERIC_EXPLODE, 4, 1);
      case COUNTDOWN -> world.playSound(at, Sound.ENTITY_CREEPER_DEATH, 1, 1);
      case GAME_START -> world.playSound(at, Sound.BLOCK_NOTE_BLOCK_HARP, 1, 1);
    }
  }

  /** {@code cue} for {@code player} alone, at their own position. */
  static void playTo(Player player, SoundCue cue, boolean original) {
    var at = Places.at(player);
    if (!original) {
      play(player.getWorld(), at, cue, false);
      return;
    }
    switch (cue) {
      case BOMB_ARMED_AGAINST_YOU -> player.playSound(at, Sound.ENTITY_BLAZE_DEATH, MAP_WIDE, 0);
      case BOMB_ARMED_FOR_YOU ->
          player.playSound(at, Sound.ENTITY_LIGHTNING_BOLT_THUNDER, MAP_WIDE, 0);
      case FUSE_WARNING -> player.playSound(at, Sound.ENTITY_BLAZE_DEATH, MAP_WIDE, 2);
      case COUNTDOWN -> player.playSound(at, Sound.ENTITY_CREEPER_DEATH, 1, 1);
      case GAME_START -> player.playSound(at, Sound.BLOCK_NOTE_BLOCK_HARP, 1, 1);
      case FUSE_TICK, FUSE_HISS, EXPLOSION -> play(player.getWorld(), at, cue, true);
    }
  }
}
