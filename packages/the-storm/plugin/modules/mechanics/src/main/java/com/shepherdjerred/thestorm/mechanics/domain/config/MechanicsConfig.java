package com.shepherdjerred.thestorm.mechanics.domain.config;

import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;

/**
 * {@code plugins/TheStorm/mechanics.yml}, owned by the repository.
 *
 * @param hiddenSwitch {@code [X]} signs behind a wall that flip levers and press buttons
 * @param lightSwitch {@code [|]} signs
 * @param cookingPot {@code [Cook]} signs
 * @param blockDrops glass and bookshelves that drop themselves
 * @param elevator {@code [Lift Up]}, {@code [Lift Down]} and {@code [Lift]} signs
 * @param bridge {@code [Bridge]} signs
 * @param gate {@code [Gate]} signs
 * @param door {@code [Door Up]} and {@code [Door Down]} signs
 * @param signCopier the sign copier tool
 * @param paintingSwitcher right-clicking a painting to change its picture
 * @param pistons the special piston signs
 */
public record MechanicsConfig(
    HiddenSwitchConfig hiddenSwitch,
    LightSwitchConfig lightSwitch,
    CookingPotConfig cookingPot,
    BlockDropsConfig blockDrops,
    ElevatorConfig elevator,
    SpanConfig bridge,
    GateConfig gate,
    SpanConfig door,
    SignCopierConfig signCopier,
    PaintingSwitcherConfig paintingSwitcher,
    PistonConfig pistons) {

  /** Who may build and use {@code feature}. */
  public Access access(Feature feature) {
    return switch (feature) {
      case HIDDEN_SWITCH -> hiddenSwitch.access();
      case LIGHT_SWITCH -> lightSwitch.access();
      case COOKING_POT -> cookingPot.access();
      case BLOCK_DROPS -> blockDrops.unlock().asAccess();
      case ELEVATOR -> elevator.access();
      case BRIDGE -> bridge.access();
      case GATE -> gate.access();
      case DOOR -> door.access();
      case SIGN_COPIER -> signCopier.unlock().asAccess();
      case PAINTING_SWITCHER -> paintingSwitcher.unlock().asAccess();
      case CRUSH -> pistons.crush().asAccess();
      case BOUNCE -> pistons.bounce().asAccess();
      case SUPER_STICKY -> pistons.superSticky().asAccess();
      case SUPER_PUSH -> pistons.superPush().asAccess();
    };
  }
}
