package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.PaperNames;
import com.shepherdjerred.thestorm.spells.domain.RefusalText;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Compass;
import com.shepherdjerred.thestorm.spells.domain.geometry.Shapes;
import java.util.EnumSet;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.entity.Player;

/**
 * Divine (II): the 2015 "Dowse for diamond ore", renamed so Dowse can put out fires. The caster
 * senses the nearest of the configured ores within range: its direction, distance and depth.
 */
final class Divine implements Spell {

  private final SpellSettings.Divine settings;
  private final Toolbox tools;
  private final Set<Material> sought = EnumSet.noneOf(Material.class);

  Divine(SpellSettings.Divine settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
    for (var name : settings.blocks()) {
      sought.add(
          PaperNames.block(name)
              .orElseThrow(() -> new IllegalStateException("divine block " + name)));
    }
  }

  @Override
  public SpellKind kind() {
    return SpellKind.DIVINE;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var eyes = caster.getEyeLocation();
    var found =
        Aim.blocks(caster.getWorld(), Shapes.ball(Aim.pos(eyes.getBlock()), settings.radius()))
            .stream()
            .filter(block -> sought.contains(block.getType()))
            .findFirst();
    if (found.isEmpty()) {
      return Result.err(CastProblem.noTarget("ore within " + settings.radius() + " blocks"));
    }
    var ore = found.get();
    var centre = ore.getLocation().add(0.5, 0.5, 0.5);
    var delta = Magic.vec(centre).minus(Magic.vec(eyes));
    return Result.ok(
        () -> {
          var toward = Magic.vec(eyes).plus(delta.normalized().times(Math.min(3, delta.length())));
          tools.fx().line(kind(), eyes, eyes.clone().set(toward.x(), toward.y(), toward.z()));
          tools.fx().sound(kind(), eyes);
          tools
              .say()
              .info(
                  caster,
                  "You sense "
                      + RefusalText.materialName(ore.getType().name())
                      + " "
                      + Compass.describe(delta)
                      + ".");
        });
  }
}
