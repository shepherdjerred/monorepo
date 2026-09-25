package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Teleports;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * Blink (III, learned in a quest): a short teleport to where the caster looks, onto the nearest
 * safe spot, in land they may teleport into. Never through walls: it stops at the first block.
 */
final class Blink implements Spell {

  private static final int SEARCH_RADIUS = 2;

  private final SpellSettings.Range settings;
  private final Toolbox tools;

  Blink(SpellSettings.Range settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.BLINK;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var from = Magic.at(caster);
    return tools
        .teleports()
        .arrival(caster, aim(caster), SEARCH_RADIUS)
        .map(
            destination ->
                () -> {
                  tools.fx().cast(kind(), from);
                  Teleports.teleport(caster, destination);
                  tools.fx().cast(kind(), destination);
                });
  }

  /** The open block in front of the first block in sight, or the end of the range in open air. */
  private Location aim(Player caster) {
    var eye = caster.getEyeLocation();
    var look = Magic.at(caster);
    var hit = tools.targets().blockInSight(caster, settings.range());
    Location spot;
    if (hit.isPresent() && hit.get().getHitBlock() != null && hit.get().getHitBlockFace() != null) {
      var block = hit.get().getHitBlock();
      var face = hit.get().getHitBlockFace();
      spot = block.getRelative(face).getLocation();
    } else {
      spot = eye.clone().add(eye.getDirection().multiply(settings.range()));
    }
    spot.setYaw(look.getYaw());
    spot.setPitch(look.getPitch());
    return spot;
  }
}
