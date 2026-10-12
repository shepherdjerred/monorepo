package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.Optional;

/**
 * The only way a bot acts in a match. Every action is validated exactly as the same action by a
 * human would be (reach, line of sight, the hit window, what is held) and then performed through
 * the real server API, never by faking Bukkit events. Humans act through the game itself; a request
 * for a human combatant is honoured the same way, which keeps the rules in one place. Main thread
 * only.
 *
 * <p>Each method returns empty when the action was performed, or why it was refused.
 */
public interface CombatantActions {

  /** Right-click {@code bombId} while holding the Bomb Fuse: arm or defuse, as the rules allow. */
  Optional<ActionRefusal> clickBomb(CombatantId id, String bombId);

  /** Right-click with the Rewind kit's Time Machine. */
  Optional<ActionRefusal> useRewind(CombatantId id);

  /** Swing the held weapon at {@code target}, who must be in reach, visible and on another team. */
  Optional<ActionRefusal> melee(CombatantId attacker, CombatantId target);

  /**
   * Shoot the held bow.
   *
   * @param direction where the arrow flies; need not be normalised
   * @param force how far the bow was drawn, 0 to 1
   */
  Optional<ActionRefusal> shootBow(CombatantId id, Vec3 direction, double force);

  /**
   * Eat what is in hotbar {@code slot} (0 to 8): a steak heals at once, a golden apple as usual.
   */
  Optional<ActionRefusal> consume(CombatantId id, int slot);

  /** Pick {@code kitId} in the lobby. */
  Optional<ActionRefusal> pickKit(CombatantId id, String kitId);
}
