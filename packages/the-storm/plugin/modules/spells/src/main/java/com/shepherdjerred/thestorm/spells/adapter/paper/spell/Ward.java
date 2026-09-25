package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.Wards;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import java.time.Duration;
import org.bukkit.entity.Player;

/**
 * Ward (IV): raises a protective bubble where the caster stands. While it lasts, hostile monsters
 * are pushed out of it, cannot pick a target inside it, and creepers inside cannot ignite. It
 * changes no blocks and only moves hostile monsters. One ward per caster; casting again moves it.
 */
final class Ward implements Spell {

  private final SpellSettings.Ward settings;
  private final Toolbox tools;

  Ward(SpellSettings.Ward settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.WARD;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var centre = Magic.at(caster);
    return Result.ok(
        () -> {
          var until = tools.time().instant().plus(Duration.ofSeconds(settings.durationSeconds()));
          tools
              .state()
              .wards()
              .raise(
                  new Wards.Ward(
                      caster.getUniqueId(),
                      centre.getWorld().getKey().asString(),
                      Magic.vec(centre),
                      settings.radius(),
                      settings.pushStrength(),
                      until));
          tools.fx().sound(kind(), centre);
          tools.fx().ring(kind(), centre, settings.radius());
        });
  }
}
