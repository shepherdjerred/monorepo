package com.shepherdjerred.thestorm.rwf.testing;

import io.papermc.paper.datacomponent.DataComponentType;
import java.util.Objects;
import org.bukkit.inventory.ItemStack;
import org.mockbukkit.mockbukkit.inventory.ItemStackMock;

/** Native clone fidelity: MockBukkit's copy constructor currently drops its component map. */
public final class ComponentStack extends ItemStackMock {
  public ComponentStack(ItemStack source) {
    super(source);
    for (var type : source.getDataTypes()) {
      if (type instanceof DataComponentType.Valued<?> valued) {
        copy(source, valued);
      } else if (type instanceof DataComponentType.NonValued marker) {
        setData(marker);
      } else {
        throw new IllegalStateException("unknown component kind: " + type);
      }
    }
  }

  private <T> void copy(ItemStack source, DataComponentType.Valued<T> type) {
    setData(type, Objects.requireNonNull(source.getData(type)));
  }

  @Override
  public ItemStack clone() {
    return new ComponentStack(this);
  }
}
