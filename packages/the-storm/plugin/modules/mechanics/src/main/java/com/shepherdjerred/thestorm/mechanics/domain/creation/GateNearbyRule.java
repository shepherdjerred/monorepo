package com.shepherdjerred.thestorm.mechanics.domain.creation;

import com.shepherdjerred.thestorm.mechanics.domain.config.GateConfig;
import com.shepherdjerred.thestorm.mechanics.domain.structure.GateFinder;
import java.util.Optional;

/**
 * A gate sign has at least one gate column within its search radius.
 *
 * @param config the gate settings
 */
public record GateNearbyRule(GateConfig config) implements CreationRule {

  @Override
  public Optional<Refusal> check(CreationRequest request) {
    return GateFinder.find(request.grid(), request.sign(), config)
        .fold(gate -> Optional.empty(), problem -> Optional.of(new Refusal(problem.message())));
  }
}
