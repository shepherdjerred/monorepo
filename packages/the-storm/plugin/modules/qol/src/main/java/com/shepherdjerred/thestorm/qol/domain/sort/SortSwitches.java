package com.shepherdjerred.thestorm.qol.domain.sort;

import com.shepherdjerred.thestorm.qol.domain.config.QolConfig;

/**
 * One player's sort switches. A player with no saved row still has the config defaults, and those
 * start with automatic sorting off.
 *
 * @param containers sort chests and other containers when they open or close
 * @param inventory sort the player's own inventory, leaving the hotbar, armor and offhand
 * @param middleClick middle-click an empty slot
 * @param shiftClick shift-click an empty slot
 * @param doubleClick double-click an empty slot
 * @param shiftRightClick shift-right-click an empty slot
 * @param dump left-click outside a container to put items in
 * @param take right-click outside a container to take items out
 * @param leftClickBlock left-click a container in the world
 */
public record SortSwitches(
    boolean containers,
    boolean inventory,
    boolean middleClick,
    boolean shiftClick,
    boolean doubleClick,
    boolean shiftRightClick,
    boolean dump,
    boolean take,
    boolean leftClickBlock) {

  /** The switches a new player starts with. */
  public static SortSwitches defaults(QolConfig.Sort.Defaults defaults) {
    return new SortSwitches(
        defaults.containers(),
        defaults.inventory(),
        defaults.middleClick(),
        defaults.shiftClick(),
        defaults.doubleClick(),
        defaults.shiftRightClick(),
        defaults.dump(),
        defaults.take(),
        defaults.leftClickBlock());
  }

  /** This switch, by its place on the settings screen. */
  public boolean enabled(int slot) {
    return switch (slot) {
      case 0 -> containers;
      case 1 -> inventory;
      case 2 -> middleClick;
      case 3 -> shiftClick;
      case 4 -> doubleClick;
      case 5 -> shiftRightClick;
      case 6 -> dump;
      case 7 -> take;
      case 8 -> leftClickBlock;
      default -> throw new IllegalArgumentException("no sort switch " + slot);
    };
  }

  /** A copy with the switch at {@code slot} flipped. */
  public SortSwitches toggle(int slot) {
    var on = !enabled(slot);
    return switch (slot) {
      case 0 ->
          new SortSwitches(
              on,
              inventory,
              middleClick,
              shiftClick,
              doubleClick,
              shiftRightClick,
              dump,
              take,
              leftClickBlock);
      case 1 ->
          new SortSwitches(
              containers,
              on,
              middleClick,
              shiftClick,
              doubleClick,
              shiftRightClick,
              dump,
              take,
              leftClickBlock);
      case 2 ->
          new SortSwitches(
              containers,
              inventory,
              on,
              shiftClick,
              doubleClick,
              shiftRightClick,
              dump,
              take,
              leftClickBlock);
      case 3 ->
          new SortSwitches(
              containers,
              inventory,
              middleClick,
              on,
              doubleClick,
              shiftRightClick,
              dump,
              take,
              leftClickBlock);
      case 4 ->
          new SortSwitches(
              containers,
              inventory,
              middleClick,
              shiftClick,
              on,
              shiftRightClick,
              dump,
              take,
              leftClickBlock);
      case 5 ->
          new SortSwitches(
              containers,
              inventory,
              middleClick,
              shiftClick,
              doubleClick,
              on,
              dump,
              take,
              leftClickBlock);
      case 6 ->
          new SortSwitches(
              containers,
              inventory,
              middleClick,
              shiftClick,
              doubleClick,
              shiftRightClick,
              on,
              take,
              leftClickBlock);
      case 7 ->
          new SortSwitches(
              containers,
              inventory,
              middleClick,
              shiftClick,
              doubleClick,
              shiftRightClick,
              dump,
              on,
              leftClickBlock);
      case 8 ->
          new SortSwitches(
              containers,
              inventory,
              middleClick,
              shiftClick,
              doubleClick,
              shiftRightClick,
              dump,
              take,
              on);
      default -> throw new IllegalArgumentException("no sort switch " + slot);
    };
  }

  /** A copy with automatic container sorting set to {@code on}. */
  public SortSwitches withContainers(boolean on) {
    return new SortSwitches(
        on,
        inventory,
        middleClick,
        shiftClick,
        doubleClick,
        shiftRightClick,
        dump,
        take,
        leftClickBlock);
  }

  /**
   * A copy with the four click hotkeys set together. If any of them is on, all go off; otherwise
   * they all go on.
   */
  public SortSwitches toggleHotkeys() {
    var on = !(middleClick || shiftClick || doubleClick || shiftRightClick);
    return new SortSwitches(containers, inventory, on, on, on, on, dump, take, leftClickBlock);
  }
}
