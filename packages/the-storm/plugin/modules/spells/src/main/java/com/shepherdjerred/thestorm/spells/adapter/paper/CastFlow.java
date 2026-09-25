package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.spell.CastProblem;
import com.shepherdjerred.thestorm.spells.adapter.paper.spell.Effect;
import com.shepherdjerred.thestorm.spells.adapter.paper.spell.Spell;
import com.shepherdjerred.thestorm.spells.adapter.paper.spell.Toolbox;
import com.shepherdjerred.thestorm.spells.domain.Refusal;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.cast.CastAttempt;
import com.shepherdjerred.thestorm.spells.domain.cast.CastMode;
import com.shepherdjerred.thestorm.spells.domain.cast.CastRules;
import com.shepherdjerred.thestorm.spells.domain.cast.CasterState;
import com.shepherdjerred.thestorm.spells.domain.cast.CooldownKey;
import com.shepherdjerred.thestorm.spells.domain.cast.ReagentPlan;
import com.shepherdjerred.thestorm.spells.domain.cast.SpellTerms;
import com.shepherdjerred.thestorm.spells.domain.config.Spellbook;
import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/**
 * One cast, start to finish: the gates (availability, tier, learning, silence, cooldown, reagents),
 * then the spell's own preparation (targets and protection), and only then payment, the cooldown
 * and the effect. Anything refused costs nothing.
 */
final class CastFlow {

  /**
   * A cooldown refusal this soon after a cast is the same click reported twice (Paper fires the
   * block and the air interaction for one click); it is not worth a message.
   */
  private static final Duration SAME_CLICK = Duration.ofMillis(300);

  private static final long MILLIS_PER_TICK = 50;

  private final Map<SpellKind, Spell> spells;
  private final Spellbook book;
  private final Toolbox tools;

  CastFlow(Map<SpellKind, Spell> spells, Spellbook book, Toolbox tools) {
    this.spells = new EnumMap<>(spells);
    this.book = book;
    this.tools = tools;
  }

  /**
   * A cast that passed every gate and whose spell is prepared: committing it pays, starts the
   * cooldown and applies the effect.
   *
   * @param caster who casts
   * @param mode focus or scroll
   * @param terms the spell's terms
   * @param effect the prepared effect
   */
  record Prepared(Player caster, CastMode mode, SpellTerms terms, Effect effect) {}

  /**
   * Casts {@code kind} from {@code item} at once; true when the spell went off (and was paid for).
   */
  boolean cast(Player caster, SpellKind kind, CastMode mode, ItemStack item) {
    var prepared = prepare(caster, kind, mode);
    prepared.ifPresent(cast -> commit(cast, item));
    return prepared.isPresent();
  }

  /**
   * Runs the gates and the spell's preparation without changing anything; tells the caster why when
   * refused.
   */
  Optional<Prepared> prepare(Player caster, SpellKind kind, CastMode mode) {
    if (!tools.state().ready()) {
      tools.say().refusal(caster, new Refusal.Loading());
      return Optional.empty();
    }
    var terms = book.entry(kind).terms();
    var refusal =
        CastRules.casting().first(new CastAttempt(mode, terms, state(caster, kind, terms)));
    if (refusal.isPresent()) {
      if (!sameClick(refusal.get(), terms)) {
        tools.say().refusal(caster, refusal.get());
      }
      return Optional.empty();
    }
    var spell = spells.get(kind);
    if (spell == null) {
      throw new IllegalStateException("no spell for " + kind);
    }
    return switch (spell.prepare(caster)) {
      case Result.Err<Effect, CastProblem>(var problem) -> {
        tools.say().problem(caster, problem);
        yield Optional.empty();
      }
      case Result.Ok<Effect, CastProblem>(var effect) ->
          Optional.of(new Prepared(caster, mode, terms, effect));
    };
  }

  /**
   * Pays for {@code cast} (reagents for a focus; a scroll is consumed by the game), starts its
   * cooldown group (drawn by the client on every item of the group) and applies the effect.
   */
  void commit(Prepared cast, ItemStack item) {
    var caster = cast.caster();
    var terms = cast.terms();
    if (cast.mode() == CastMode.FOCUS) {
      Reagents.take(caster.getInventory(), terms.cost());
    }
    var cooldownKey = new CooldownKey(caster.getUniqueId(), terms.cooldownGroup());
    tools.state().cooldowns().start(cooldownKey, terms.cooldown(), tools.time().instant());
    caster.setCooldown(item, (int) (terms.cooldown().toMillis() / MILLIS_PER_TICK));
    cast.effect().apply();
  }

  private CasterState state(Player caster, SpellKind kind, SpellTerms terms) {
    var now = tools.time().instant();
    var state = tools.state();
    var id = caster.getUniqueId();
    var held = ReagentPlan.held(Reagents.stacks(caster.getInventory(), terms.cost()));
    return new CasterState(
        Access.tier(caster),
        Access.learned(caster, kind),
        state.silences().remaining(id, now),
        state.cooldowns().remaining(new CooldownKey(id, terms.cooldownGroup()), now),
        held);
  }

  private static boolean sameClick(Refusal refusal, SpellTerms terms) {
    return refusal instanceof Refusal.OnCooldown(var remaining)
        && terms.cooldown().minus(remaining).compareTo(SAME_CLICK) < 0;
  }
}
