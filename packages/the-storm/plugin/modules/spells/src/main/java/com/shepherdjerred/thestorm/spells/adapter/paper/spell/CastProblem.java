package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.spells.domain.Refusal;
import com.shepherdjerred.thestorm.spells.domain.Screening;
import net.kyori.adventure.text.Component;

/** Why a spell could not be prepared: a domain refusal or the land-protection port's denial. */
public sealed interface CastProblem {

  /** A rule of the spell system refused. */
  record Refused(Refusal refusal) implements CastProblem {}

  /** Land protection refused; {@code reason} is the port's own message. */
  record Protected(Component reason) implements CastProblem {}

  static CastProblem refused(Refusal refusal) {
    return new Refused(refusal);
  }

  static CastProblem noTarget(String what) {
    return new Refused(new Refusal.NoTarget(what));
  }

  /**
   * The problem when a screening allowed nothing: the first protection denial, or "no {@code what}"
   * when there was nothing to screen.
   */
  static CastProblem nothingAllowed(Screening.Screened<?, Component> screened, String what) {
    return screened.firstDenial().<CastProblem>map(Protected::new).orElseGet(() -> noTarget(what));
  }
}
