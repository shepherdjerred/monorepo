package com.shepherdjerred.thestorm.essentials.app;

/**
 * The registry of {@link TeleportGuard}s, published by essentials. A module enabled after
 * essentials adds its guards with {@code
 * context.services().require(TeleportGuards.class).add(...)}.
 *
 * <p>Every player teleport essentials performs ({@code /spawn}, {@code /home}, {@code /tpa}, {@code
 * /back}, {@code /warp}) consults every guard twice: when the command is used and again when the
 * warmup ends. Any refusal cancels the teleport before the player is charged. Staff moves (first
 * join to spawn) are not guarded.
 */
public interface TeleportGuards {

  /** Adds {@code guard}. Guards cannot be removed; a disabled module's guard should allow all. */
  void add(TeleportGuard guard);
}
