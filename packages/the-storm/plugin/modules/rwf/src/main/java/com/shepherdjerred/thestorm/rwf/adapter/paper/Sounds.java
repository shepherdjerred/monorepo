package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.match.SoundCue;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.World;

/** The sounds Red Warfare played, as the rules name them. */
final class Sounds {

  private Sounds() {}

  static void play(World world, Location at, SoundCue cue) {
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
}
