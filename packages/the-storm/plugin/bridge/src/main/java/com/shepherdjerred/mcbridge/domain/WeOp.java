package com.shepherdjerred.mcbridge.domain;

import org.jspecify.annotations.Nullable;

/**
 * One WorldEdit command with its explicit selection and placement, so nothing depends on state a
 * previous op left behind.
 *
 * @param command the command, starting with {@code //}
 * @param pos1 the primary selection corner, if any
 * @param pos2 the secondary selection corner, if any
 * @param at the placement position (pos1 with placement POS1) for commands like {@code //sphere}
 */
public record WeOp(
    String command, @Nullable BlockPos pos1, @Nullable BlockPos pos2, @Nullable BlockPos at) {

  public WeOp {
    if (!command.startsWith("//")) {
      throw BridgeException.badRequest("WorldEdit commands start with //: " + command);
    }
    if (pos1 != null && at != null) {
      throw BridgeException.badRequest(
          "op sets both pos1 and at; at already sets pos1 as the placement position");
    }
  }

  /** The command name WorldEdit registers (e.g. {@code /set} for {@code //set stone}). */
  public String commandName() {
    String withoutSlash = command.substring(1);
    int space = withoutSlash.indexOf(' ');
    return space < 0 ? withoutSlash : withoutSlash.substring(0, space);
  }
}
