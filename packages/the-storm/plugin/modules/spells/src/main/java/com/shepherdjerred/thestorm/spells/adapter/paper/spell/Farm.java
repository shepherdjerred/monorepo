package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Growth;
import com.shepherdjerred.thestorm.spells.domain.geometry.Shapes;
import java.util.EnumSet;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.data.Ageable;
import org.bukkit.entity.Player;

/**
 * Farm (II): crops around the caster grow by a few stages, in land where the caster may build. Only
 * crops ripen; cacti, cane, bamboo and fire are left alone.
 */
final class Farm implements Spell {

  private static final Set<Material> OTHER_CROPS =
      EnumSet.of(Material.NETHER_WART, Material.COCOA, Material.SWEET_BERRY_BUSH);

  private final SpellSettings.Farm settings;
  private final Toolbox tools;

  Farm(SpellSettings.Farm settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.FARM;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var feet = Aim.pos(Magic.at(caster).getBlock());
    var crops =
        Aim.blocks(caster.getWorld(), Shapes.cylinder(feet, settings.radius(), 1, 1)).stream()
            .filter(Farm::growable)
            .toList();
    var screened = tools.guard().blocks(caster, ProtectedAction.BUILD, crops);
    if (screened.isEmpty()) {
      return Result.err(CastProblem.nothingAllowed(screened, "crop to grow"));
    }
    return Result.ok(
        () -> {
          for (var crop : screened.allowed()) {
            grow(crop);
          }
          tools.fx().sound(kind(), Magic.at(caster));
        });
  }

  private static boolean growable(Block block) {
    var type = block.getType();
    return (Tag.CROPS.isTagged(type) || OTHER_CROPS.contains(type))
        && block.getBlockData() instanceof Ageable ageable
        && Growth.canGrow(ageable.getAge(), ageable.getMaximumAge());
  }

  private void grow(Block crop) {
    if (!(crop.getBlockData() instanceof Ageable ageable)) {
      return;
    }
    ageable.setAge(Growth.grow(ageable.getAge(), ageable.getMaximumAge(), settings.stages()));
    crop.setBlockData(ageable);
    tools.fx().burst(kind(), crop.getLocation().add(0.5, 0.5, 0.5), 4, 0.25);
  }
}
