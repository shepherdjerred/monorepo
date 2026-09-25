package com.shepherdjerred.thestorm.spells;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.spells.adapter.db.JooqSpellStore;
import com.shepherdjerred.thestorm.spells.adapter.paper.SpellsPaper;
import com.shepherdjerred.thestorm.spells.app.SpellScrolls;
import com.shepherdjerred.thestorm.spells.domain.config.SpellsConfig;
import org.jspecify.annotations.Nullable;

/**
 * Spells: the Spellcaster track's spell items (reusable foci and single-use scrolls), gated by
 * track tier and quest learning, paid in reagents, and checked against land protection. Requires
 * {@link Protection} (the towns module); publishes {@link SpellScrolls}.
 */
public final class SpellsModule implements StormModule {

  private @Nullable SpellsPaper paper;

  @Override
  public String id() {
    return "spells";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("spells.yml", SpellsConfig.class);
    context.database().migrate(id(), SpellsModule.class.getClassLoader());
    var protection = context.services().require(Protection.class);
    var installed =
        SpellsPaper.install(context, config, new JooqSpellStore(context.database()), protection);
    paper = installed;
    context.services().provide(SpellScrolls.class, installed.scrolls());
  }

  @Override
  public void disable() {
    var installed = paper;
    if (installed != null) {
      installed.stop();
      paper = null;
    }
  }
}
