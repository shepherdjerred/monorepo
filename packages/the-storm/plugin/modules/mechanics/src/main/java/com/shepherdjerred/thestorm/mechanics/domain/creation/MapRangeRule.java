package com.shepherdjerred.thestorm.mechanics.domain.creation;

import com.shepherdjerred.thestorm.mechanics.domain.config.MapChangerConfig;
import com.shepherdjerred.thestorm.mechanics.domain.tools.MapRange;
import java.util.Optional;

/**
 * A map changer sign names a valid range of map ids on its third line.
 *
 * @param config the map changer settings
 */
public record MapRangeRule(MapChangerConfig config) implements CreationRule {

  @Override
  public Optional<Refusal> check(CreationRequest request) {
    return MapRange.parse(request.view().line(MapRange.LINE), config.maxRange())
        .fold(range -> Optional.empty(), message -> Optional.of(new Refusal(message)));
  }
}
