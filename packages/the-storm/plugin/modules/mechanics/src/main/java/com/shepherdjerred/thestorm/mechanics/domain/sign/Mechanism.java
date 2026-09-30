package com.shepherdjerred.thestorm.mechanics.domain.sign;

/** A mechanism built from a sign, named by the sign's tag line. */
public enum Mechanism {
  HIDDEN_SWITCH(Feature.HIDDEN_SWITCH, "[X]"),
  LIGHT_SWITCH(Feature.LIGHT_SWITCH, "[|]"),
  COOKING_POT(Feature.COOKING_POT, "[Cook]"),
  LIFT_UP(Feature.ELEVATOR, "[Lift Up]"),
  LIFT_DOWN(Feature.ELEVATOR, "[Lift Down]"),
  LIFT(Feature.ELEVATOR, "[Lift]"),
  BRIDGE(Feature.BRIDGE, "[Bridge]"),
  GATE(Feature.GATE, "[Gate]"),
  DOOR_UP(Feature.DOOR, "[Door Up]"),
  DOOR_DOWN(Feature.DOOR, "[Door Down]"),
  CRUSH(Feature.CRUSH, "[Crush]"),
  BOUNCE(Feature.BOUNCE, "[Bounce]"),
  SUPER_STICKY(Feature.SUPER_STICKY, "[SuperSticky]"),
  SUPER_PUSH(Feature.SUPER_PUSH, "[SuperPush]");

  private final Feature feature;
  private final String tag;

  Mechanism(Feature feature, String tag) {
    this.feature = feature;
    this.tag = tag;
  }

  public Feature feature() {
    return feature;
  }

  /** The canonical tag line, written back onto the sign when it is created. */
  public String tag() {
    return tag;
  }

  /** A sign elevator stop. */
  public boolean isLift() {
    return feature == Feature.ELEVATOR;
  }

  /** A sign that changes a piston's behavior. */
  public boolean isPiston() {
    return switch (feature) {
      case CRUSH, BOUNCE, SUPER_STICKY, SUPER_PUSH -> true;
      case HIDDEN_SWITCH,
          LIGHT_SWITCH,
          COOKING_POT,
          BLOCK_DROPS,
          ELEVATOR,
          BRIDGE,
          GATE,
          DOOR,
          SIGN_COPIER,
          PAINTING_SWITCHER ->
          false;
    };
  }

  /** A bridge, gate or door: a structure that opens and closes. */
  public boolean isStructure() {
    return feature == Feature.BRIDGE || feature == Feature.GATE || feature == Feature.DOOR;
  }
}
