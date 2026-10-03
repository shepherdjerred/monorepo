package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.mojang.brigadier.arguments.StringArgumentType;
import io.papermc.paper.command.brigadier.Commands;

/** Explicit bounded provisioning; a successful preview is required before any write. */
final class SettlementCommands {
  private SettlementCommands() {}

  static void register(Commands commands, SettlementProvisioner provisioner) {
    commands.register(
        Commands.literal("settlement")
            .requires(source -> source.getSender().hasPermission(ArenaPermissions.ADMIN))
            .then(
                Commands.literal("preview")
                    .executes(
                        c -> {
                          provisioner.preview(c.getSource().getSender());
                          return 1;
                        }))
            .then(
                Commands.literal("apply")
                    .then(
                        Commands.argument("token", StringArgumentType.word())
                            .executes(
                                c -> {
                                  provisioner.apply(
                                      c.getSource().getSender(),
                                      StringArgumentType.getString(c, "token"));
                                  return 1;
                                })))
            .then(
                Commands.literal("restore")
                    .then(
                        Commands.argument("token", StringArgumentType.word())
                            .executes(
                                c -> {
                                  provisioner.restore(
                                      c.getSource().getSender(),
                                      StringArgumentType.getString(c, "token"));
                                  return 1;
                                })))
            .build(),
        "Preview, provision, or restore the authored settlement footprint");
  }
}
