package com.shepherdjerred.thestorm.spells.domain.temporary;

/**
 * Whether reverting a temporary block should put the original back. The rule never overwrites a
 * block someone else put there, and is safe to apply twice (after a crash, a revert may be retried
 * against a world that already has the original).
 */
public final class RevertRule {

  private RevertRule() {}

  /** What to do with one due block. */
  public enum Action {
    /** Put the original block data back. */
    RESTORE,
    /** Leave the world alone; just forget the record. */
    LEAVE
  }

  /**
   * Decides a revert given the block data now in the world.
   *
   * @param block the record
   * @param current the block data string at its position now
   * @param currentIsAir whether that block is air (the placed block was somehow removed)
   */
  public static Action decide(TemporaryBlock block, String current, boolean currentIsAir) {
    if (current.equals(block.original())) {
      return Action.LEAVE;
    }
    if (current.equals(block.placed()) || currentIsAir) {
      return Action.RESTORE;
    }
    return Action.LEAVE;
  }
}
