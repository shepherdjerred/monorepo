package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Teleports;
import com.shepherdjerred.thestorm.spells.domain.Refusal;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Facing;
import com.shepherdjerred.thestorm.spells.domain.geometry.PhaseSearch;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * Phase (II): the caster steps through the wall in front of them to the first safe spot on its far
 * side, if they may enter the land there.
 */
final class Phase implements Spell {

  private final SpellSettings.Phase settings;
  private final Toolbox tools;

  Phase(SpellSettings.Phase settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.PHASE;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var from = Magic.at(caster);
    var outcome =
        PhaseSearch.through(
            Teleports.probe(caster.getWorld()),
            Aim.pos(from.getBlock()),
            Facing.fromYaw(from.getYaw()),
            settings.reach());
    return switch (outcome) {
      case PhaseSearch.Outcome.NoWall() -> Result.err(CastProblem.refused(new Refusal.NoWall()));
      case PhaseSearch.Outcome.NoExit() ->
          Result.err(CastProblem.refused(new Refusal.NoSafeSpot()));
      case PhaseSearch.Outcome.Through(var feet) -> {
        var point = feet.feet();
        var destination =
            new Location(
                caster.getWorld(), point.x(), point.y(), point.z(), from.getYaw(), from.getPitch());
        yield tools
            .guard()
            .denial(caster, ProtectedAction.TELEPORT_INTO, destination)
            .<Result<Effect, CastProblem>>map(
                reason -> Result.err(new CastProblem.Protected(reason)))
            .orElseGet(
                () ->
                    Result.ok(
                        () -> {
                          tools.fx().cast(kind(), from);
                          Teleports.teleport(caster, destination);
                          tools.fx().cast(kind(), destination);
                        }));
      }
    };
  }
}
