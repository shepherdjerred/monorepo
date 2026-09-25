package com.shepherdjerred.thestorm.mechanics.domain.creation;

import com.shepherdjerred.thestorm.mechanics.domain.config.SpanConfig;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import com.shepherdjerred.thestorm.mechanics.domain.structure.SpanFinder;
import java.util.Optional;

/**
 * A bridge or door sign sits against a base block of an allowed material: above or below a bridge
 * sign, above a {@code [Door Up]} sign, below a {@code [Door Down]} sign. The far end may be built
 * later, so it is checked on use.
 *
 * @param config the bridge or door settings
 */
public record SpanBaseRule(SpanConfig config) implements CreationRule {

  @Override
  public Optional<Refusal> check(CreationRequest request) {
    var base =
        request.mechanism() == Mechanism.BRIDGE
            ? SpanFinder.bridgeBase(request.grid(), request.sign(), config)
            : SpanFinder.doorBase(request.grid(), request.sign(), request.mechanism(), config);
    return base.fold(
        pos -> Optional.empty(), problem -> Optional.of(new Refusal(problem.message())));
  }
}
