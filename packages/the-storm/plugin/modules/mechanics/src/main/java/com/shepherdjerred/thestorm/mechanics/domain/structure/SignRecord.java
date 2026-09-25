package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import java.util.Optional;

/**
 * What a sign in the world currently reads and remembers.
 *
 * @param mechanism the mechanism its tag line names, if any
 * @param binding the structure it was bound to, if any
 * @param stock the blocks it holds
 */
public record SignRecord(Optional<Mechanism> mechanism, Optional<Binding> binding, Stock stock) {

  /** Its binding as a gate sign, if it is one. */
  Optional<Binding.GateFrame> gateFrame() {
    var gateSign = mechanism.filter(own -> own.feature() == Feature.GATE).isPresent();
    return binding
        .filter(bound -> gateSign)
        .filter(Binding.GateFrame.class::isInstance)
        .map(Binding.GateFrame.class::cast);
  }

  /** Its binding as a bridge or door end of {@code mechanism}'s feature. */
  Optional<Binding.SpanEnd> spanEndFor(Mechanism of) {
    var sameFeature = mechanism.filter(own -> own.feature() == of.feature()).isPresent();
    return binding
        .filter(bound -> sameFeature)
        .filter(Binding.SpanEnd.class::isInstance)
        .map(Binding.SpanEnd.class::cast);
  }
}
