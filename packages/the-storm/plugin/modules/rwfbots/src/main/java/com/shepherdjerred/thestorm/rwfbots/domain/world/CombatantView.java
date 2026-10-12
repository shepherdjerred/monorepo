package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.AABB;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/**
 * One combatant as the server knows them this tick. Perception decides what a viewer can tell from
 * this; {@link #apparentTeam(TeamId)} is what a viewer on that team would see on the name tag.
 *
 * @param id who
 * @param team the real team
 * @param disguised whether this combatant appears to enemies as one of their own (Spy)
 * @param kit the kit in play
 * @param alive whether still in the match
 * @param pos the feet position
 * @param vel the velocity per tick
 * @param yaw the look yaw, Minecraft convention
 * @param pitch the look pitch, Minecraft convention
 * @param health hearts times two, 0..20
 * @param absorption extra hearts from golden apples
 * @param armorValue the armor points worn, 0..20
 * @param heldSlot the selected hotbar slot, 0..8
 * @param sprinting whether sprinting
 * @param onGround whether standing on something
 * @param usingItem whether drawing a bow, eating or otherwise holding right click
 * @param invisible whether the invisibility effect is active
 * @param lastHurtTick the tick of the last damage taken, or -1 if none
 */
public record CombatantView(
    CombatantId id,
    TeamId team,
    boolean disguised,
    Kit kit,
    boolean alive,
    Vec3 pos,
    Vec3 vel,
    double yaw,
    double pitch,
    double health,
    double absorption,
    double armorValue,
    int heldSlot,
    boolean sprinting,
    boolean onGround,
    boolean usingItem,
    boolean invisible,
    long lastHurtTick) {

  /** How far above the feet a standing player's eyes are. */
  public static final double EYE_HEIGHT = 1.62;

  /** The most health a player has. */
  public static final double MAX_HEALTH = 20;

  public CombatantView {
    if (!(health >= 0 && health <= MAX_HEALTH)) {
      throw new IllegalArgumentException("health must be 0..20: " + health);
    }
    if (!(absorption >= 0) || !(armorValue >= 0 && armorValue <= 20)) {
      throw new IllegalArgumentException("absorption and armor must be in range");
    }
    if (heldSlot < 0 || heldSlot > 8) {
      throw new IllegalArgumentException("held slot must be 0..8: " + heldSlot);
    }
    if (lastHurtTick < -1) {
      throw new IllegalArgumentException("lastHurtTick must be -1 or a tick: " + lastHurtTick);
    }
    if (!Double.isFinite(yaw) || !(pitch >= -90 && pitch <= 90)) {
      throw new IllegalArgumentException("yaw must be finite and pitch -90..90");
    }
  }

  /** The team a viewer on {@code viewerTeam} would read off this combatant. */
  public TeamId apparentTeam(TeamId viewerTeam) {
    return disguised ? viewerTeam : team;
  }

  /** Whether this combatant is, by appearance, on the same team as a viewer on {@code viewer}. */
  public boolean appearsAlliedTo(TeamId viewer) {
    return apparentTeam(viewer).equals(viewer);
  }

  public Vec3 eye() {
    return pos.plus(0, EYE_HEIGHT, 0);
  }

  public Facing facing() {
    return new Facing(yaw, pitch);
  }

  public AABB box() {
    return AABB.playerAt(pos, false);
  }

  /** Health plus absorption. */
  public double effectiveHealth() {
    return health + absorption;
  }

  public CombatantView withPos(Vec3 newPos) {
    return new CombatantView(
        id,
        team,
        disguised,
        kit,
        alive,
        newPos,
        vel,
        yaw,
        pitch,
        health,
        absorption,
        armorValue,
        heldSlot,
        sprinting,
        onGround,
        usingItem,
        invisible,
        lastHurtTick);
  }

  public CombatantView withVel(Vec3 newVel) {
    return new CombatantView(
        id,
        team,
        disguised,
        kit,
        alive,
        pos,
        newVel,
        yaw,
        pitch,
        health,
        absorption,
        armorValue,
        heldSlot,
        sprinting,
        onGround,
        usingItem,
        invisible,
        lastHurtTick);
  }

  public CombatantView withFacing(Facing facing) {
    return new CombatantView(
        id,
        team,
        disguised,
        kit,
        alive,
        pos,
        vel,
        facing.yaw(),
        facing.pitch(),
        health,
        absorption,
        armorValue,
        heldSlot,
        sprinting,
        onGround,
        usingItem,
        invisible,
        lastHurtTick);
  }

  public CombatantView withHealth(double newHealth, double newAbsorption) {
    return new CombatantView(
        id,
        team,
        disguised,
        kit,
        alive,
        pos,
        vel,
        yaw,
        pitch,
        newHealth,
        newAbsorption,
        armorValue,
        heldSlot,
        sprinting,
        onGround,
        usingItem,
        invisible,
        lastHurtTick);
  }

  public CombatantView withAlive(boolean nowAlive) {
    return new CombatantView(
        id,
        team,
        disguised,
        kit,
        nowAlive,
        pos,
        vel,
        yaw,
        pitch,
        health,
        absorption,
        armorValue,
        heldSlot,
        sprinting,
        onGround,
        usingItem,
        invisible,
        lastHurtTick);
  }

  public CombatantView withInvisible(boolean nowInvisible, double newArmor) {
    return new CombatantView(
        id,
        team,
        disguised,
        kit,
        alive,
        pos,
        vel,
        yaw,
        pitch,
        health,
        absorption,
        newArmor,
        heldSlot,
        sprinting,
        onGround,
        usingItem,
        nowInvisible,
        lastHurtTick);
  }

  public CombatantView withDisguised(boolean nowDisguised) {
    return new CombatantView(
        id,
        team,
        nowDisguised,
        kit,
        alive,
        pos,
        vel,
        yaw,
        pitch,
        health,
        absorption,
        armorValue,
        heldSlot,
        sprinting,
        onGround,
        usingItem,
        invisible,
        lastHurtTick);
  }

  public CombatantView withLastHurtTick(long tick) {
    return new CombatantView(
        id,
        team,
        disguised,
        kit,
        alive,
        pos,
        vel,
        yaw,
        pitch,
        health,
        absorption,
        armorValue,
        heldSlot,
        sprinting,
        onGround,
        usingItem,
        invisible,
        tick);
  }

  public CombatantView withMotion(boolean nowSprinting, boolean nowOnGround) {
    return new CombatantView(
        id,
        team,
        disguised,
        kit,
        alive,
        pos,
        vel,
        yaw,
        pitch,
        health,
        absorption,
        armorValue,
        heldSlot,
        nowSprinting,
        nowOnGround,
        usingItem,
        invisible,
        lastHurtTick);
  }

  public CombatantView withHands(int slot, boolean nowUsingItem) {
    return new CombatantView(
        id,
        team,
        disguised,
        kit,
        alive,
        pos,
        vel,
        yaw,
        pitch,
        health,
        absorption,
        armorValue,
        slot,
        sprinting,
        onGround,
        nowUsingItem,
        invisible,
        lastHurtTick);
  }
}
