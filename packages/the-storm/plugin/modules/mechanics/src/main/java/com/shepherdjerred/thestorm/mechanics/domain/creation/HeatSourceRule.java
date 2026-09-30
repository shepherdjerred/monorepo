package com.shepherdjerred.thestorm.mechanics.domain.creation;

import com.shepherdjerred.thestorm.mechanics.domain.config.CookingPotConfig;
import com.shepherdjerred.thestorm.mechanics.domain.tools.CookingPot;
import java.util.Optional;

/**
 * A cooking pot sign has a heat source one or two blocks below it.
 *
 * @param config the cooking pot settings
 */
public record HeatSourceRule(CookingPotConfig config) implements CreationRule {

  @Override
  public Optional<Refusal> check(CreationRequest request) {
    return CookingPot.heatSource(request.grid(), request.sign(), config).isPresent()
        ? Optional.empty()
        : Optional.of(new Refusal("Put a fire or campfire one or two blocks below the sign."));
  }
}
