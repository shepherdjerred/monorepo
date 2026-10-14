package com.shepherdjerred.thestorm.rwfbots.testing;

import java.util.UUID;
import java.util.function.Consumer;
import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.entity.TextDisplay;
import org.bukkit.event.entity.EntitySpawnEvent;
import org.jspecify.annotations.Nullable;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.TextDisplayMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * Text-display visibility metadata with the normal initializer, registration and removal lifecycle.
 */
public final class VisibilityWorldMock extends WorldMock {
  private final ServerMock server;

  public VisibilityWorldMock(ServerMock server, String name) {
    // The harness authors its floor at y=0; MockBukkit's default grass through y=4 would bury it.
    super(org.bukkit.Material.AIR, -64, 320, -64);
    setName(name);
    this.server = server;
  }

  @Override
  public <T extends Entity> T spawn(
      Location location, Class<T> type, @Nullable Consumer<? super T> initializer) {
    if (type != TextDisplay.class) return super.spawn(location, type, initializer);
    var display = new VisibleTextDisplay(server, UUID.randomUUID());
    display.setLocation(location);
    display.setSpawnReason(org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason.CUSTOM);
    var entity = type.cast(display);
    if (initializer != null) initializer.accept(entity);
    server.registerEntity(display);
    if (!new EntitySpawnEvent(display).callEvent()) display.remove();
    return entity;
  }

  private static final class VisibleTextDisplay extends TextDisplayMock {
    private boolean visible = true;
    private org.bukkit.entity.Display.Billboard billboard =
        org.bukkit.entity.Display.Billboard.FIXED;

    VisibleTextDisplay(ServerMock server, UUID uuid) {
      super(server, uuid);
    }

    @Override
    public void setVisibleByDefault(boolean value) {
      visible = value;
    }

    @Override
    public boolean isVisibleByDefault() {
      return visible;
    }

    @Override
    public void setBillboard(org.bukkit.entity.Display.Billboard value) {
      billboard = value;
    }

    @Override
    public org.bukkit.entity.Display.Billboard getBillboard() {
      return billboard;
    }
  }
}
