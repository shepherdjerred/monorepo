package com.shepherdjerred.thestorm.qol.domain.config;

import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy;
import java.time.Duration;

/**
 * {@code plugins/TheStorm/qol.yml}, owned by the repository.
 *
 * @param graves where graves go and who may open them when
 * @param combat combat tags
 * @param sleep the sleep vote
 * @param sort chest sorting
 */
public record QolConfig(Graves graves, Combat combat, Sleep sleep, Sort sort) {

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
   * The sleep vote.
   *
   * @param percent the share (1-100) of counted players who must sleep
   * @param morningMessage told to the world's players when the night is skipped
   */
  public record Sleep(int percent, String morningMessage) {

    public Sleep {
      if (percent < 1 || percent > 100) {
        throw new IllegalArgumentException("percent must be 1-100: " + percent);
      }
      if (morningMessage.isBlank()) {
        throw new IllegalArgumentException("morningMessage must not be blank");
      }
    }
  }

  /**
   * Chest sorting.
   *
   * @param sneakPunch whether punching a container while sneaking with an empty hand sorts it, as
   *     well as {@code /sort}
   */
  public record Sort(boolean sneakPunch) {}
}
