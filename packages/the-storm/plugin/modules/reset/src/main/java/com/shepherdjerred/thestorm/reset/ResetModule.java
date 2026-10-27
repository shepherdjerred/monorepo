package com.shepherdjerred.thestorm.reset;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry;
import com.shepherdjerred.thestorm.reset.adapter.db.JooqResetStore;
import com.shepherdjerred.thestorm.reset.adapter.files.VanillaPlayerReset;
import com.shepherdjerred.thestorm.reset.adapter.luckperms.LuckPermsReset;
import com.shepherdjerred.thestorm.reset.adapter.paper.PaperResetOperations;
import com.shepherdjerred.thestorm.reset.adapter.paper.ResetPaper;
import com.shepherdjerred.thestorm.reset.app.PlayerResetService;
import net.luckperms.api.LuckPermsProvider;
import org.jspecify.annotations.Nullable;

/** Full player resets for repeating the server's first-join experience. */
public final class ResetModule implements StormModule {

  private @Nullable ResetPaper paper;

  @Override
  public String id() {
    return "reset";
  }

  @Override
  public void enable(ModuleContext context) {
    context.services().require(PlayerResetRegistry.class).stateless(id());
    context.database().migrate(id(), getClass().getClassLoader());
    var store = new JooqResetStore(context.database());
    var server = context.plugin().getServer();
    var operations =
        new PaperResetOperations(
            server,
            new VanillaPlayerReset(server, context.compute()),
            new LuckPermsReset(LuckPermsProvider.get()),
            context);
    var resets =
        new PlayerResetService(
            store,
            context.services().require(PlayerResetRegistry.class),
            operations,
            new PlayerResetService.Timing(
                context.scheduler(),
                context.time(),
                message -> context.logger().info("{}", message)));
    paper = ResetPaper.start(context, store, resets);
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              var _ =
                  resets
                      .resume()
                      .whenComplete(
                          (ignored, failure) -> {
                            if (failure != null) {
                              context
                                  .logger()
                                  .error("Could not resume pending player resets", failure);
                            }
                          });
            });
  }

  @Override
  public void disable() {
    if (paper != null) {
      paper.stop();
      paper = null;
    }
  }
}
