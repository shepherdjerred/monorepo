package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import org.bukkit.entity.Player;

/**
 * Mark (I): remembers where the caster stands, for Recall. One Mark per player; it may only be set
 * where the caster could set a home ({@link ProtectedAction#SET_HOME}).
 */
final class Mark implements Spell {

  private final Toolbox tools;

  Mark(Toolbox tools) {
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.MARK;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var here = Magic.at(caster);
    var denial = tools.guard().denial(caster, ProtectedAction.SET_HOME, here);
    if (denial.isPresent()) {
      return Result.err(new CastProblem.Protected(denial.get()));
    }
    return Result.ok(
        () -> {
          tools.waypoints().mark(caster.getUniqueId(), here);
          tools.fx().cast(kind(), here);
          tools
              .say()
              .success(
                  caster,
                  "Marked "
                      + here.getBlockX()
                      + ", "
                      + here.getBlockY()
                      + ", "
                      + here.getBlockZ()
                      + ". Recall returns you here.");
        });
  }
}
