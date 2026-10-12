// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/WraithAbility.java
// with GhostAbility.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * The Wraith is a {@link Ghost} with a bow instead of a sword and pearls. Drawing the bow shows it
 * in its team's colour, its arrows trail that colour, and loosing one takes its arrow away for 2
 * seconds, after which it comes back to the same slot.
 */
public final class Wraith extends Ghost {

  public static final String ID = "wraith";

  public static final Duration RELOAD = Duration.ofSeconds(2);

  /**
   * An arrow on its way back.
   *
   * @param slot the inventory slot it returns to
   * @param at when
   */
  public record Reload(int slot, Instant at) {}

  /**
   * A Wraith's state.
   *
   * @param ghost what it shares with the Ghost
   * @param reloads arrows on their way back, soonest first
   */
  public record State(Ghost.State ghost, List<Reload> reloads) implements KitState {

    public State {
      reloads = List.copyOf(reloads);
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.effect(new AbilityEffect.Visibility(self.id(), AbilityEffect.Seen.GHOST));
    // Red Warfare filled the bar when the match began: the bow is ready.
    arena.effect(new AbilityEffect.Meter(self.id(), 0, 1));
    return new State(new Ghost.State(List.of()), List.of());
  }

  @Override
  protected Ghost.State ghost(Fighter self, Arena arena) {
    return arena.state(self.id(), State.class).ghost();
  }

  @Override
  protected void keep(Fighter self, Arena arena, Ghost.State ghost) {
    arena.state(self.id(), new State(ghost, arena.state(self.id(), State.class).reloads()));
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof AbilityInput.ShootBow shot)) {
      return;
    }
    var state = arena.state(self.id(), State.class);
    var reloads = new ArrayList<>(state.reloads());
    reloads.add(new Reload(shot.arrowSlot(), arena.now().plus(RELOAD)));
    arena.state(self.id(), new State(state.ghost(), reloads));
    arena.effect(new AbilityEffect.Take(self.id(), "ARROW", 64));
    arena.use(self.id(), ID, RELOAD, true);
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    super.tick(self, motion, arena);
    var state = arena.state(self.id(), State.class);
    if (state.reloads().isEmpty() || !arena.now().isAfter(state.reloads().getFirst().at())) {
      return;
    }
    var left = new ArrayList<Reload>();
    for (var reload : state.reloads()) {
      if (!arena.now().isAfter(reload.at())) {
        left.add(reload);
      } else {
        arena.effect(new AbilityEffect.SetSlot(self.id(), reload.slot(), ItemSpec.of("ARROW")));
      }
    }
    arena.state(self.id(), new State(state.ghost(), left));
  }
}
