package com.shepherdjerred.thestorm.towns.domain.lock;

/** A lock option the owner turns on or off, besides town sharing and redstone. */
public enum LockFlag {
  HOPPER,
  HOPPER_IN,
  HOPPER_OUT,
  GOLEM,
  MAGNET,
  AUTOCLOSE,
  EXPLOSIONS,
  EXEMPT;

  public boolean isOn(Lock.Flags flags) {
    return switch (this) {
      case HOPPER -> flags.hopper();
      case HOPPER_IN -> flags.hopperIn();
      case HOPPER_OUT -> flags.hopperOut();
      case GOLEM -> flags.golem();
      case MAGNET -> flags.magnet();
      case AUTOCLOSE -> flags.autoclose();
      case EXPLOSIONS -> flags.explosions();
      case EXEMPT -> flags.exempt();
    };
  }

  public Lock.Flags apply(Lock.Flags flags, boolean on) {
    return switch (this) {
      case HOPPER ->
          new Lock.Flags(
              on,
              flags.hopperIn(),
              flags.hopperOut(),
              flags.golem(),
              flags.magnet(),
              flags.autoclose(),
              flags.explosions(),
              flags.exempt());
      case HOPPER_IN ->
          new Lock.Flags(
              flags.hopper(),
              on,
              flags.hopperOut(),
              flags.golem(),
              flags.magnet(),
              flags.autoclose(),
              flags.explosions(),
              flags.exempt());
      case HOPPER_OUT ->
          new Lock.Flags(
              flags.hopper(),
              flags.hopperIn(),
              on,
              flags.golem(),
              flags.magnet(),
              flags.autoclose(),
              flags.explosions(),
              flags.exempt());
      case GOLEM ->
          new Lock.Flags(
              flags.hopper(),
              flags.hopperIn(),
              flags.hopperOut(),
              on,
              flags.magnet(),
              flags.autoclose(),
              flags.explosions(),
              flags.exempt());
      case MAGNET ->
          new Lock.Flags(
              flags.hopper(),
              flags.hopperIn(),
              flags.hopperOut(),
              flags.golem(),
              on,
              flags.autoclose(),
              flags.explosions(),
              flags.exempt());
      case AUTOCLOSE ->
          new Lock.Flags(
              flags.hopper(),
              flags.hopperIn(),
              flags.hopperOut(),
              flags.golem(),
              flags.magnet(),
              on,
              flags.explosions(),
              flags.exempt());
      case EXPLOSIONS ->
          new Lock.Flags(
              flags.hopper(),
              flags.hopperIn(),
              flags.hopperOut(),
              flags.golem(),
              flags.magnet(),
              flags.autoclose(),
              on,
              flags.exempt());
      case EXEMPT ->
          new Lock.Flags(
              flags.hopper(),
              flags.hopperIn(),
              flags.hopperOut(),
              flags.golem(),
              flags.magnet(),
              flags.autoclose(),
              flags.explosions(),
              on);
    };
  }
}
