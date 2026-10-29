package com.shepherdjerred.thestorm.client;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.Minecraft;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;

/** A bounded camera turn using the ordinary client tick and rendered interpolation. */
final class CameraPan {
  private @Nullable UUID owner;
  private @Nullable CompletableFuture<Object> completion;
  private float yaw;
  private float pitch;
  private float turn;
  private float tilt;
  private int ticks;
  private int elapsed;

  boolean active() {
    return owner != null;
  }

  CompletableFuture<Object> start(Minecraft client, UUID peer, JsonNode args) {
    Protocol.keys(args, Set.of("yaw", "pitch", "ticks"));
    if (active()) throw new IllegalStateException("Another camera pan is active");
    var player = java.util.Objects.requireNonNull(client.player);
    yaw = player.getYRot();
    pitch = player.getXRot();
    turn = (float) Math.IEEEremainder(Protocol.angle(args, "yaw", -360, 360) - yaw, 360);
    tilt = Protocol.angle(args, "pitch", -90, 90) - pitch;
    ticks = Protocol.integer(args, "ticks", 1, 100);
    elapsed = 0;
    owner = peer;
    var result = new CompletableFuture<Object>();
    completion = result;
    return result;
  }

  void tick(Minecraft client) {
    if (!active()) return;
    var player = client.player;
    if (player == null || player.isDeadOrDying() || client.gui.screen() != null) {
      cancel();
      return;
    }
    var progress = (float) ++elapsed / ticks;
    var ease = progress * progress * (3 - 2 * progress);
    player.setYRot(yaw + turn * ease);
    player.setXRot(pitch + tilt * ease);
    if (elapsed == ticks) finish(false);
  }

  void disconnect(UUID peer) {
    if (peer.equals(owner)) cancel();
  }

  void cancel() {
    if (active()) finish(true);
  }

  private void finish(boolean cancelled) {
    var result = java.util.Objects.requireNonNull(completion);
    owner = null;
    completion = null;
    if (cancelled) result.completeExceptionally(new IllegalStateException("Camera pan cancelled"));
    else result.complete("Camera pan completed");
  }
}
