package com.shepherdjerred.thestorm.qol.domain.config;

import com.shepherdjerred.thestorm.qol.domain.bank.BankRole;
import com.shepherdjerred.thestorm.qol.domain.bank.LimitSet;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * {@code plugins/TheStorm/qol.yml}, owned by the repository.
 *
 * @param graves where graves go and who may open them when
 * @param combat combat tags
 * @param sleep the sleep vote
 * @param sort chest sorting
 * @param bank deposit banks that shelve items into labeled containers
 */
public record QolConfig(Graves graves, Combat combat, Sleep sleep, Sort sort, Bank bank) {

  /**
   * Graves.
   *
   * @param lockedFor how long only the owner may open a grave
   * @param expireAfter how long after the death a grave breaks open and drops what is left
   * @param searchRadius how far from the death a grave may go
   */
  public record Graves(Duration lockedFor, Duration expireAfter, int searchRadius) {

    public Graves {
      // Validates the durations.
      var _ = new GravePolicy(lockedFor, expireAfter);
      if (searchRadius < 1 || searchRadius > GravePlacement.MAX_RADIUS) {
        throw new IllegalArgumentException(
            "searchRadius must be 1-" + GravePlacement.MAX_RADIUS + ": " + searchRadius);
      }
    }

    public GravePolicy policy() {
      return new GravePolicy(lockedFor, expireAfter);
    }
  }

  /**
   * Combat tags.
   *
   * @param tagFor how long a hit between players keeps both in combat
   * @param killOnLogout whether logging out while tagged kills the player (their items go to a
   *     grave)
   * @param logoutMessage told to everyone when that happens; {@code {player}} is the player's name
   */
  public record Combat(Duration tagFor, boolean killOnLogout, String logoutMessage) {

    public Combat {
      if (!tagFor.isPositive()) {
        throw new IllegalArgumentException("tagFor must be positive: " + tagFor);
      }
      if (!logoutMessage.contains("{player}")) {
        throw new IllegalArgumentException("logoutMessage must name {player}");
      }
    }
  }

  /**
   * The sleep vote, run by vanilla's {@code players_sleeping_percentage} rule; players marked AFK
   * are left out of the count.
   *
   * @param percent the share (0-100) of a world's counted players who must sleep
   */
  public record Sleep(int percent) {

    public Sleep {
      if (percent < 0 || percent > 100) {
        throw new IllegalArgumentException("percent must be 0-100: " + percent);
      }
    }
  }

  /**
   * Chest sorting.
   *
   * @param sneakPunch whether punching a container while sneaking with an empty hand sorts it, as
   *     well as {@code /sort}
   * @param sortTime when an automatic sort runs
   * @param hotkeyCooldownMillis the least time between one player's hotkeys
   * @param defaults what a player starts with before they change it
   * @param blockedHolders holder class names that must not be sorted, as regular expressions
   * @param preventNullHolders whether an inventory with no holder is left alone
   * @param disabledWorlds worlds where automatic sorting does not run
   */
  public record Sort(
      boolean sneakPunch,
      When sortTime,
      int hotkeyCooldownMillis,
      Defaults defaults,
      List<String> blockedHolders,
      boolean preventNullHolders,
      List<String> disabledWorlds) {

    public Sort {
      blockedHolders = List.copyOf(blockedHolders);
      disabledWorlds = List.copyOf(disabledWorlds);
      if (hotkeyCooldownMillis < 0) {
        throw new IllegalArgumentException(
            "hotkeyCooldownMillis must not be negative: " + hotkeyCooldownMillis);
      }
      for (var pattern : blockedHolders) {
        try {
          Pattern.compile(pattern);
        } catch (IllegalArgumentException e) {
          throw new IllegalArgumentException("blockedHolders has a bad pattern: " + pattern, e);
        }
      }
    }

    /** When a container with automatic sorting turned on is sorted. */
    public enum When {
      OPEN,
      CLOSE,
      BOTH
    }

    /**
     * A new player's sort switches.
     *
     * @param containers automatic sorting of chests and other containers
     * @param inventory automatic sorting of the player's own inventory
     * @param middleClick middle-click an empty slot
     * @param shiftClick shift-click an empty slot
     * @param doubleClick double-click an empty slot
     * @param shiftRightClick shift-right-click an empty slot
     * @param dump left-click outside the container to put items in
     * @param take right-click outside the container to take items out
     * @param leftClickBlock left-click a container in the world to sort it
     */
    public record Defaults(
        boolean containers,
        boolean inventory,
        boolean middleClick,
        boolean shiftClick,
        boolean doubleClick,
        boolean shiftRightClick,
        boolean dump,
        boolean take,
        boolean leftClickBlock) {}
  }

  /**
   * Deposit banks.
   *
   * @param limits how many banks and shelves, and how far they may reach
   * @param fallbackRole what a player who is not on the access list may do
   * @param verticalTwo whether a sign also claims containers two blocks above and below
   * @param horizontalTwo whether a sign also claims containers two blocks to either side
   * @param signInFront whether a sign also claims the container it is attached to, behind it
   * @param groups extra limits granted by {@code thestorm.qol.bank.limits.<name>}
   */
  public record Bank(
      LimitSet limits,
      BankRole fallbackRole,
      boolean verticalTwo,
      boolean horizontalTwo,
      boolean signInFront,
      Map<String, LimitSet> groups) {

    public Bank {
      groups = Map.copyOf(groups);
      for (var name : groups.keySet()) {
        if (!name.matches("[a-z0-9-]{1,32}")) {
          throw new IllegalArgumentException(
              "a bank limit group is named with a-z, 0-9 and -: " + name);
        }
      }
    }
  }
}
