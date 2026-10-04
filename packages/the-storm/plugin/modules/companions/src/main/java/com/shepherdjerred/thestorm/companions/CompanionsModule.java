package com.shepherdjerred.thestorm.companions;

import com.shepherdjerred.thestorm.companions.adapter.coreprotect.NaturalBlockAudit;
import com.shepherdjerred.thestorm.companions.adapter.db.JooqCompanionStore;
import com.shepherdjerred.thestorm.companions.adapter.http.FliptCompanionGate;
import com.shepherdjerred.thestorm.companions.adapter.http.HttpConversation;
import com.shepherdjerred.thestorm.companions.adapter.paper.CompanionsPaper;
import com.shepherdjerred.thestorm.companions.domain.CompanionsConfig;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.protection.Protection;
import java.net.URI;
import net.coreprotect.CoreProtect;
import org.jspecify.annotations.Nullable;

/** Citizens-backed survival with local game AI; availability is independently flag gated. */
public final class CompanionsModule implements StormModule {
  private @Nullable CompanionsPaper running;

  @Override
  public String id() {
    return "companions";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("companions.yml", CompanionsConfig.class);
    context.database().migrate(id(), getClass().getClassLoader());
    var plugin = context.plugin().getServer().getPluginManager().getPlugin("CoreProtect");
    if (!(plugin instanceof CoreProtect coreProtect))
      throw new IllegalStateException("Companions require CoreProtect");
    var gate =
        new FliptCompanionGate(URI.create(required("FLIPT_URL")), required("FLIPT_ENVIRONMENT"));
    running =
        new CompanionsPaper(
            context,
            config,
            new CompanionsPaper.Parts(
                new JooqCompanionStore(context.database()),
                gate,
                new NaturalBlockAudit(coreProtect.getAPI()),
                context.services().require(Protection.class),
                new HttpConversation(
                    URI.create(config.brainUrl()), required("STORM_BRAIN_BEARER_TOKEN"))));
  }

  private static String required(String key) {
    var value = System.getenv(key);
    if (value == null || value.isBlank())
      throw new IllegalStateException("Companions require bootstrap variable " + key);
    return value;
  }

  @Override
  public void disable() {
    if (running != null) {
      running.close();
      running = null;
    }
  }
}
