package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Objects;
import org.bukkit.entity.Player;

/**
 * The three native 26.3 item operations Paper does not expose: actual right-click use, release, and
 * a spear's piercing jab. Exact signatures are linked once at production startup. Missing
 * signatures are a server-version contract failure, never a reason to simulate weaker weapons. No
 * Citizens implementation is used here.
 */
final class PaperNativeItems {

  private PaperNativeItems() {}

  static void verifyLinkage() {
    Objects.requireNonNull(Linked.BINDINGS);
  }

  static void start(Player player) {
    var b = Linked.BINDINGS;
    var body = invoke(b.handle(), player);
    var stack = invoke(b.mainHand(), body);
    var level = invoke(b.level(), body);
    call(b.use(), read(b.gameMode(), body), body, level, stack, b.mainHandConstant());
  }

  static void release(Player player) {
    call(Linked.BINDINGS.release(), invoke(Linked.BINDINGS.handle(), player));
  }

  static boolean jab(Player player) {
    var b = Linked.BINDINGS;
    var body = invoke(b.handle(), player);
    var stack = invoke(b.mainHand(), body);
    if (Boolean.TRUE.equals(invoke(b.cannotAttack(), body, stack, 5))) {
      return false;
    }
    var piercing = invoke(b.component(), stack, b.piercingComponent());
    call(b.jab(), piercing, body, b.mainHandSlot());
    return true;
  }

  private static final class Linked {
    private static final Bindings BINDINGS = bind();
  }

  private record Bindings(
      Method handle,
      Method mainHand,
      Method level,
      Field gameMode,
      Method use,
      Method release,
      Method component,
      Method jab,
      Method cannotAttack,
      Object mainHandConstant,
      Object mainHandSlot,
      Object piercingComponent) {}

  private static Bindings bind() {
    try {
      var craft = Class.forName("org.bukkit.craftbukkit.entity.CraftLivingEntity");
      var living = Class.forName("net.minecraft.world.entity.LivingEntity");
      var player = Class.forName("net.minecraft.server.level.ServerPlayer");
      var level = Class.forName("net.minecraft.world.level.Level");
      var hand = Class.forName("net.minecraft.world.InteractionHand");
      var slot = Class.forName("net.minecraft.world.entity.EquipmentSlot");
      var stack = Class.forName("net.minecraft.world.item.ItemStack");
      var mode = Class.forName("net.minecraft.server.level.ServerPlayerGameMode");
      var component = Class.forName("net.minecraft.core.component.DataComponentType");
      var components = Class.forName("net.minecraft.core.component.DataComponents");
      var piercing = Class.forName("net.minecraft.world.item.component.PiercingWeapon");
      return new Bindings(
          craft.getMethod("getHandle"),
          living.getMethod("getMainHandItem"),
          living.getMethod("level"),
          player.getField("gameMode"),
          mode.getMethod("useItem", player, level, stack, hand),
          living.getMethod("releaseUsingItem"),
          stack.getMethod("get", component),
          piercing.getMethod("attack", living, slot),
          player.getMethod("cannotAttackWithItem", stack, int.class),
          Objects.requireNonNull(hand.getField("MAIN_HAND").get(null)),
          Objects.requireNonNull(slot.getField("MAINHAND").get(null)),
          Objects.requireNonNull(components.getField("PIERCING_WEAPON").get(null)));
    } catch (ReflectiveOperationException failure) {
      throw new IllegalStateException("Pinned Paper 26.3 native weapon linkage failed", failure);
    }
  }

  private static Object invoke(Method method, Object receiver, Object... arguments) {
    try {
      return Objects.requireNonNull(
          method.invoke(receiver, arguments), "Native weapon getter returned null: " + method);
    } catch (IllegalAccessException failure) {
      throw new IllegalStateException(
          "Native weapon method became inaccessible: " + method, failure);
    } catch (InvocationTargetException failure) {
      throw new IllegalStateException("Native weapon action failed: " + method, failure.getCause());
    }
  }

  private static void call(Method method, Object receiver, Object... arguments) {
    try {
      method.invoke(receiver, arguments);
    } catch (IllegalAccessException failure) {
      throw new IllegalStateException(
          "Native weapon method became inaccessible: " + method, failure);
    } catch (InvocationTargetException failure) {
      throw new IllegalStateException("Native weapon action failed: " + method, failure.getCause());
    }
  }

  private static Object read(Field field, Object receiver) {
    try {
      return Objects.requireNonNull(field.get(receiver));
    } catch (IllegalAccessException failure) {
      throw new IllegalStateException("Native weapon field became inaccessible: " + field, failure);
    }
  }
}
