package com.shepherdjerred.thestorm.client;

import java.util.List;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.world.phys.BlockHitResult;
import tools.jackson.databind.JsonNode;

/** Recheck the actual sign hit on the client thread immediately before a recovery swing. */
final class RecoveryTarget {
  private RecoveryTarget() {}

  record Observed(String world, List<Integer> position, boolean sign, Set<String> held) {}

  static void verify(Minecraft client, Protocol.Request request, Set<String> held) {
    var mode = java.util.Objects.requireNonNull(client.gameMode);
    if (!request.action().equals("attack")
        || mode.getPlayerMode() != net.minecraft.world.level.GameType.CREATIVE)
      throw new IllegalStateException("Recovery requires one creative-mode sign punch");
    var hit = client.hitResult;
    var block =
        hit instanceof BlockHitResult result
                && hit.getType() == net.minecraft.world.phys.HitResult.Type.BLOCK
            ? result.getBlockPos()
            : null;
    var level = java.util.Objects.requireNonNull(client.level);
    verify(
        request.arguments(),
        new Observed(
            level.dimension().identifier().toString(),
            block == null ? List.of() : List.of(block.getX(), block.getY(), block.getZ()),
            block != null && level.getBlockState(block).is(net.minecraft.tags.BlockTags.ALL_SIGNS),
            held));
  }

  static void verify(JsonNode args, Observed actual) {
    Protocol.keys(args, Set.of("expectedBlock", "expectedWorld"));
    var expected = args.required("expectedBlock");
    if (!actual.world().equals(Protocol.text(args, "expectedWorld", 100))
        || !actual.sign()
        || !expected.isArray()
        || expected.size() != 3
        || actual.position().size() != 3
        || actual.held().stream().anyMatch(button -> !button.equals("sneak")))
      throw new IllegalStateException("Recovery sign target changed");
    for (var axis = 0; axis < 3; axis++) {
      var coordinate = expected.get(axis);
      if (!coordinate.isIntegralNumber()
          || !coordinate.canConvertToInt()
          || coordinate.intValue() != actual.position().get(axis))
        throw new IllegalStateException("Recovery sign target changed");
    }
  }
}
