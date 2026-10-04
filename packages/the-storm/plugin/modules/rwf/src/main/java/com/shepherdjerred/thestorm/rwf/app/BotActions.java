package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.app.view.Point;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;

/**
 * {@link CombatantActions} keyed by entity UUID, for modules that know combatants only by the UUIDs
 * {@link com.shepherdjerred.thestorm.rwf.app.view.MatchState} shows them. Every request is resolved
 * against the running match and performed through {@link CombatantActions}, so the same rules
 * apply; a UUID that is not in the match is refused as {@link ActionRefusal#NOT_A_MEMBER}. Main
 * thread only.
 */
public interface BotActions {

  Optional<ActionRefusal> clickBomb(UUID bot, String bombId);

  Optional<ActionRefusal> useRewind(UUID bot);

  Optional<ActionRefusal> melee(UUID attacker, UUID target);

  /**
   * Shoot the held bow.
   *
   * @param direction where the arrow flies; need not be normalised
   * @param force how far the bow was drawn, 0 to 1
   */
  Optional<ActionRefusal> shootBow(UUID bot, Point direction, double force);

  Optional<ActionRefusal> consume(UUID bot, int slot);

  Optional<ActionRefusal> pickKit(UUID bot, String kitId);

  /** The actions over {@code actions}, resolving UUIDs through {@code view}. */
  static BotActions over(CombatantActions actions, MatchView view) {
    return new BotActions() {
      private Optional<CombatantId> resolve(UUID uuid) {
        return view.current()
            .flatMap(
                snapshot ->
                    snapshot.combatants().stream()
                        .map(combatant -> combatant.id())
                        .filter(id -> id.uuid().equals(uuid))
                        .findFirst());
      }

      private Optional<ActionRefusal> as(
          UUID uuid, Function<CombatantId, Optional<ActionRefusal>> action) {
        var id = resolve(uuid);
        if (id.isEmpty()) {
          return Optional.of(ActionRefusal.NOT_A_MEMBER);
        }
        return action.apply(id.orElseThrow());
      }

      @Override
      public Optional<ActionRefusal> clickBomb(UUID bot, String bombId) {
        return as(bot, id -> actions.clickBomb(id, bombId));
      }

      @Override
      public Optional<ActionRefusal> useRewind(UUID bot) {
        return as(bot, actions::useRewind);
      }

      @Override
      public Optional<ActionRefusal> melee(UUID attacker, UUID target) {
        return as(attacker, a -> as(target, t -> actions.melee(a, t)));
      }

      @Override
      public Optional<ActionRefusal> shootBow(UUID bot, Point direction, double force) {
        var vector = new Vec3(direction.x(), direction.y(), direction.z());
        return as(bot, id -> actions.shootBow(id, vector, force));
      }

      @Override
      public Optional<ActionRefusal> consume(UUID bot, int slot) {
        return as(bot, id -> actions.consume(id, slot));
      }

      @Override
      public Optional<ActionRefusal> pickKit(UUID bot, String kitId) {
        return as(bot, id -> actions.pickKit(id, kitId));
      }
    };
  }
}
