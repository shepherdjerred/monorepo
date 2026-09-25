package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Harm;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Pairing;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;

/**
 * Confusion (I): the hostile monsters the caster can see turn on each other. Monsters on land where
 * the caster may not build are left alone.
 */
final class Confusion implements Spell {

  private final SpellSettings.Radius settings;
  private final Toolbox tools;

  Confusion(SpellSettings.Radius settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.CONFUSION;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Aim.hostiles(tools, caster, settings.radius(), "pair of monsters nearby")
        .flatMap(
            monsters ->
                monsters.size() < 2
                    ? Result.err(CastProblem.noTarget("pair of monsters nearby"))
                    : Result.ok(monsters))
        .map(
            monsters ->
                () -> {
                  for (var pair : Pairing.turnOnEachOther(monsters, tools.random())) {
                    Mob target = pair.target();
                    tools
                        .harm()
                        .strike(
                            caster,
                            pair.attacker(),
                            Harm.Blow.none().then(attacker -> pair.attacker().setTarget(target)));
                    tools.fx().burst(kind(), Magic.chest(pair.attacker()), 8, 0.3);
                  }
                  tools.fx().sound(kind(), Magic.at(caster));
                });
  }
}
