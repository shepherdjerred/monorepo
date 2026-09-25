package com.shepherdjerred.thestorm.mechanics.domain.creation;

import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import java.util.List;
import java.util.Optional;

/** The structural rules each mechanism's sign must meet when it is written. */
public final class CreationRules {

  private final MechanicsConfig config;

  private CreationRules(MechanicsConfig config) {
    this.config = config;
  }

  /** The rules for the configured mechanisms. */
  public static CreationRules standard(MechanicsConfig config) {
    return new CreationRules(config);
  }

  private static List<CreationRule> rulesFor(Mechanism mechanism, MechanicsConfig config) {
    return switch (mechanism) {
      case HIDDEN_SWITCH -> List.of(new WallMountedRule());
      case LIGHT_SWITCH, LIFT_UP, LIFT_DOWN, LIFT -> List.of();
      case COOKING_POT -> List.of(new HeatSourceRule(config.cookingPot()));
      case BRIDGE -> List.of(new SquareFacingRule(), new SpanBaseRule(config.bridge()));
      case DOOR_UP, DOOR_DOWN -> List.of(new SquareFacingRule(), new SpanBaseRule(config.door()));
      case GATE -> List.of(new GateNearbyRule(config.gate()));
      case CRUSH, BOUNCE, SUPER_PUSH -> List.of(new AdjacentPistonRule(false));
      case SUPER_STICKY -> List.of(new AdjacentPistonRule(true));
    };
  }

  /** The first rule the sign breaks, if any. */
  public Optional<Refusal> check(CreationRequest request) {
    return rulesFor(request.mechanism(), config).stream()
        .map(rule -> rule.check(request))
        .flatMap(Optional::stream)
        .findFirst();
  }
}
