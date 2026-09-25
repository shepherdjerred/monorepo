package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Chain;
import java.util.List;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/**
 * Chain Lightning (V): lightning leaps from the caster to the creature in sight, then on to the
 * nearest creatures around it, weakening with each jump. It only jumps to creatures the caster may
 * harm.
 */
final class ChainLightning implements Spell {

  private final SpellSettings.Chain settings;
  private final Toolbox tools;

  ChainLightning(SpellSettings.Chain settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.CHAINLIGHTNING;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Aim.creature(tools, caster, settings.range())
        .map(
            first -> {
              var path = path(caster, first);
              return () -> strike(caster, path);
            });
  }

  private List<LivingEntity> path(Player caster, LivingEntity first) {
    var reach = settings.jumpRange() * settings.maxTargets();
    var nearby = tools.targets().around(caster, first.getLocation(), reach);
    var candidates =
        tools.guard().creatures(caster, nearby).allowed().stream()
            .map(creature -> new Chain.Link<>(creature, Magic.vec(creature.getLocation())))
            .toList();
    return Chain.path(
        new Chain.Link<>(first, Magic.vec(first.getLocation())),
        candidates,
        settings.jumpRange(),
        settings.maxTargets());
  }

  private void strike(Player caster, List<LivingEntity> path) {
    var from = caster.getEyeLocation();
    for (var index = 0; index < path.size(); index++) {
      var target = path.get(index);
      var to = Magic.chest(target);
      tools.fx().line(kind(), from, to);
      Magic.hurt(target, Chain.damageAt(settings.damage(), settings.falloff(), index), caster);
      from = to;
    }
    tools.fx().sound(kind(), Magic.at(caster));
  }
}
