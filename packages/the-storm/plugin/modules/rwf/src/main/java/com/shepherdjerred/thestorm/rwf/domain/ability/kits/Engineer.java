package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.Placed;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.time.Duration;

/**
 * The Engineer raises a 3-wide, 2-high brick barricade across where it looks, standing on the block
 * it clicks, for 8 seconds; it recharges for 25. It can never be raised with any of its blocks
 * within {@link #BOMB_CLEARANCE} blocks of a bomb. Every barricade crumbles on time, whether or not
 * its Engineer lives, and the match reset puts the ground back.
 */
public final class Engineer implements Ability {

  public static final String ID = "engineer";

  public static final String BLOCK = "BRICKS";
  public static final Duration STANDS = Duration.ofSeconds(8);
  public static final Duration RECHARGE = Duration.ofSeconds(25);
  public static final double BOMB_CLEARANCE = 4;

  @Override
  public String id() {
    return ID;
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof AbilityInput.Barricade barricade)) {
      return;
    }
    if (!arena.ready(self.id(), ID)) {
      arena.say(self.id(), "Your barricade is not ready yet!", AbilityEffect.Tone.REFUSED);
      return;
    }
    if (barricade.wall().isEmpty()) {
      arena.say(self.id(), "There is no room for a barricade there!", AbilityEffect.Tone.REFUSED);
      return;
    }
    if (nearBomb(barricade, arena)) {
      arena.say(
          self.id(),
          "You cannot build a barricade this close to a bomb!",
          AbilityEffect.Tone.REFUSED);
      return;
    }
    var taken =
        arena.placed().stream()
            .flatMap(p -> p.blocks().stream())
            .anyMatch(barricade.wall()::contains);
    if (taken) {
      arena.say(self.id(), "There is no room for a barricade there!", AbilityEffect.Tone.REFUSED);
      return;
    }
    arena.use(self.id(), ID, RECHARGE, true);
    arena.place(new Placed.Barricade(self.id(), barricade.wall(), arena.now().plus(STANDS)));
    for (var block : barricade.wall()) {
      arena.effect(new AbilityEffect.PlaceBlock(block, BLOCK));
    }
    arena.effect(new AbilityEffect.CueAt(barricade.wall().getFirst(), KitCue.BLOCK_CHANGED));
  }

  private static boolean nearBomb(AbilityInput.Barricade barricade, Arena arena) {
    for (var bomb : arena.bombs()) {
      for (var block : barricade.wall()) {
        if (distance(bomb, block) <= BOMB_CLEARANCE) {
          return true;
        }
      }
    }
    return false;
  }

  private static double distance(BlockPos a, BlockPos b) {
    return a.center().distanceTo(b.center());
  }

  @Override
  public void anyTick(Arena arena) {
    for (var placed : arena.placed()) {
      if (placed instanceof Placed.Barricade barricade
          && !arena.now().isBefore(barricade.until())) {
        arena.unplace(barricade);
        for (var block : barricade.blocks()) {
          arena.effect(new AbilityEffect.ClearBlock(block));
        }
        arena.effect(new AbilityEffect.CueAt(barricade.blocks().getFirst(), KitCue.BLOCK_CHANGED));
      }
    }
  }
}
