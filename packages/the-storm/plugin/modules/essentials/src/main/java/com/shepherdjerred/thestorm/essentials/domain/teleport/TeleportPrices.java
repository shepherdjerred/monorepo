package com.shepherdjerred.thestorm.essentials.domain.teleport;

/**
 * The base price of every teleport kind. One field per kind, so a missing kind is a parse error.
 *
 * @param spawn {@code /spawn}
 * @param home {@code /home}
 * @param tpa an accepted {@code /tpa} or {@code /tpahere}, paid by the player who asked
 * @param back {@code /back}
 * @param warp {@code /warp}
 */
public record TeleportPrices(
    TeleportPrice spawn,
    TeleportPrice home,
    TeleportPrice tpa,
    TeleportPrice back,
    TeleportPrice warp) {

  /** The base price of {@code kind}. */
  public TeleportPrice of(TeleportKind kind) {
    return switch (kind) {
      case SPAWN -> spawn;
      case HOME -> home;
      case TPA -> tpa;
      case BACK -> back;
      case WARP -> warp;
    };
  }
}
