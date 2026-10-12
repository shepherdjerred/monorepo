package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.Placed;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.time.Duration;
import java.util.Optional;

/**
 * The Bannerman plants its team's banner, one at a time, at most once every 45 seconds. Every
 * second, allies within {@link #REACH} blocks of the banner get Regeneration I. An enemy tears it
 * down in {@link #STRIKES} strikes; it goes when the Bannerman dies, and the banner item comes back
 * whenever it falls.
 */
public final class Bannerman implements Ability {

  public static final String ID = "bannerman";

  public static final double REACH = 6;
  public static final int STRIKES = 3;
  public static final Duration RECHARGE = Duration.ofSeconds(45);
  public static final Duration PULSE = Duration.ofSeconds(1);

  /** Regeneration lasts a little past each pulse so it never flickers off. */
  public static final int REGEN_TICKS = 50;

  private static final String PULSE_KEY = "banner-pulse";

  @Override
  public String id() {
    return ID;
  }

  /** The banner block {@code team} plants. */
  public static String banner(TeamColor team) {
    return team.name() + "_BANNER";
  }

  /** The kit's banner item. */
  public static ItemSpec item() {
    return KitBook.BANNERMAN.hotbar().get(1);
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof AbilityInput.PlantBanner plant)) {
      return;
    }
    if (planted(self.id(), arena).isPresent()) {
      arena.say(self.id(), "Your banner is already planted!", AbilityEffect.Tone.REFUSED);
      return;
    }
    if (!arena.ready(self.id(), ID)) {
      arena.say(self.id(), "Your banner is not ready yet!", AbilityEffect.Tone.REFUSED);
      return;
    }
    if (arena.placed().stream().anyMatch(p -> p.blocks().contains(plant.block()))) {
      return;
    }
    arena.use(self.id(), ID, RECHARGE, true);
    arena.place(new Placed.Banner(self.id(), self.team(), plant.block(), STRIKES));
    arena.effect(new AbilityEffect.Take(self.id(), banner(self.team()), 1));
    arena.effect(new AbilityEffect.PlaceBlock(plant.block(), banner(self.team())));
    arena.effect(new AbilityEffect.CueAt(plant.block(), KitCue.BLOCK_CHANGED));
    arena.say(
        arena.allies(self).stream().map(Fighter::id).toList(),
        self.name() + " planted a rallying banner!",
        AbilityEffect.Tone.GOOD);
  }

  /** Every banner pulses once a second, after everyone has moved. */
  @Override
  public void anyTick(Arena arena) {
    for (var placed : arena.placed()) {
      if (!(placed instanceof Placed.Banner banner) || !arena.ready(banner.owner(), PULSE_KEY)) {
        continue;
      }
      arena.use(banner.owner(), PULSE_KEY, PULSE, false);
      var at = banner.block().center();
      for (var ally : arena.living()) {
        var position = arena.position(ally.id());
        if (ally.team() == banner.team()
            && !ally.id().equals(banner.owner())
            && position.isPresent()
            && position.orElseThrow().distanceTo(at) <= REACH) {
          arena.effect(
              new AbilityEffect.Potion(
                  ally.id(), "regeneration", 0, REGEN_TICKS, Optional.of(banner.owner())));
        }
      }
    }
  }

  @Override
  public void touched(Fighter owner, Fighter actor, AbilityInput.Touch touch, Arena arena) {
    if (!(touch instanceof AbilityInput.StrikeBanner) || actor.allyOf(owner)) {
      return;
    }
    var banner = planted(owner.id(), arena).filter(b -> b.block().equals(touch.block()));
    if (banner.isEmpty()) {
      return;
    }
    var left = banner.orElseThrow().strikesLeft() - 1;
    arena.effect(new AbilityEffect.CueAt(touch.block(), KitCue.BLOCK_CHANGED));
    if (left > 0) {
      var b = banner.orElseThrow();
      arena.replace(b, new Placed.Banner(b.owner(), b.team(), b.block(), left));
      return;
    }
    remove(banner.orElseThrow(), arena);
    arena.say(owner.id(), actor.name() + " tore down your banner!", AbilityEffect.Tone.REFUSED);
    arena.say(actor.id(), "You tore down " + owner.name() + "'s banner!", AbilityEffect.Tone.GOOD);
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    if (death.victim().equals(self.id())) {
      planted(self.id(), arena).ifPresent(banner -> remove(banner, arena));
    }
  }

  private static void remove(Placed.Banner banner, Arena arena) {
    arena.unplace(banner);
    arena.effect(new AbilityEffect.ClearBlock(banner.block()));
    arena.effect(new AbilityEffect.Give(banner.owner(), item(), 1));
  }

  /** {@code owner}'s planted banner, if any. */
  public static Optional<Placed.Banner> planted(CombatantId owner, Arena arena) {
    return arena.placed().stream()
        .filter(p -> p instanceof Placed.Banner b && b.owner().equals(owner))
        .map(Placed.Banner.class::cast)
        .findFirst();
  }
}
