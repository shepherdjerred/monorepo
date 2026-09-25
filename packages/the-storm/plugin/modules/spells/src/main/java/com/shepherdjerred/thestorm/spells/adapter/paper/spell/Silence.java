package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.RefusalText;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import java.time.Duration;
import org.bukkit.entity.Player;

/**
 * Silence (I): the player in sight cannot cast spells for a while. It counts as harming them, so it
 * obeys the claim's PvP decision.
 */
final class Silence implements Spell {

  private final SpellSettings.Targeted settings;
  private final Toolbox tools;

  Silence(SpellSettings.Targeted settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.SILENCE;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Aim.creature(tools, caster, settings.range())
        .flatMap(
            target ->
                target instanceof Player victim
                    ? Result.ok(victim)
                    : Result.err(CastProblem.noTarget("player in sight")))
        .map(
            victim ->
                () -> {
                  var duration = Duration.ofSeconds(settings.durationSeconds());
                  tools
                      .state()
                      .silences()
                      .start(victim.getUniqueId(), duration, tools.time().instant());
                  tools.fx().line(kind(), caster.getEyeLocation(), Magic.chest(victim));
                  tools.fx().cast(kind(), Magic.chest(victim));
                  tools
                      .say()
                      .error(
                          victim,
                          caster.getName()
                              + " silenced you for "
                              + RefusalText.seconds(duration)
                              + ".");
                  tools
                      .say()
                      .success(
                          caster,
                          "Silenced "
                              + victim.getName()
                              + " for "
                              + RefusalText.seconds(duration)
                              + ".");
                });
  }
}
