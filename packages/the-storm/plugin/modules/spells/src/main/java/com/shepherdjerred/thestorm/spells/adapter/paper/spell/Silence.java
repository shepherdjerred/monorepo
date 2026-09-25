package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Harm;
import com.shepherdjerred.thestorm.spells.domain.RefusalText;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import java.time.Duration;
import org.bukkit.entity.Player;

/**
 * Silence (I): the player in sight cannot cast spells for a while. It is harm, so it needs PvP on
 * both the caster's and the victim's land.
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
        .map(victim -> () -> silence(caster, victim));
  }

  private void silence(Player caster, Player victim) {
    var duration = Duration.ofSeconds(settings.durationSeconds());
    var landed =
        tools
            .harm()
            .strike(
                caster,
                victim,
                Harm.Blow.none()
                    .then(
                        target ->
                            tools
                                .state()
                                .silences()
                                .start(victim.getUniqueId(), duration, tools.time().instant())));
    if (!landed) {
      return;
    }
    tools.fx().line(kind(), caster.getEyeLocation(), Magic.chest(victim));
    tools.fx().cast(kind(), Magic.chest(victim));
    var time = RefusalText.seconds(duration);
    tools.say().error(victim, caster.getName() + " silenced you for " + time + ".");
    tools.say().success(caster, "Silenced " + victim.getName() + " for " + time + ".");
  }
}
