package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Offline, pinned-Paper shape conversion. Never loaded by the production plugin. Native shape rules
 * read the complete schematic through a read-only level; no world, physics or ticks run.
 */
public final class MapConnections {
  private static final Set<String> CONNECTIONS = Set.of("north", "south", "east", "west", "up");

  public record Result(Schematic blocks, int changed) {}

  private MapConnections() {}

  /** Shape-dependent properties only; authored orientation and all other properties stay intact. */
  private static Set<String> derived(String state) {
    var name = state.split("\\[", 2)[0];
    if (name.endsWith("_fence")
        || name.endsWith("_pane")
        || name.endsWith("_wall")
        || name.equals("minecraft:iron_bars")) return CONNECTIONS;
    if (name.endsWith("_stairs")) return Set.of("shape");
    if (name.endsWith("_fence_gate")) return Set.of("in_wall");
    return Set.of();
  }

  private static String authored(String state, Set<String> derived) {
    var parts = state.split("\\[", 2);
    if (parts.length == 1) return state;
    var properties = new ArrayList<String>();
    for (var property : parts[1].replace("]", "").split(",", -1)) {
      if (!derived.contains(property.split("=", 2)[0])) properties.add(property);
    }
    return parts[0] + properties;
  }

  /**
   * Reflection confines the version-specific server contract to this disposable conversion tool.
   */
  public static Result normalize(Schematic input) throws ReflectiveOperationException {
    var nativeState = Class.forName("net.minecraft.world.level.block.state.BlockState");
    var position = Class.forName("net.minecraft.core.BlockPos");
    var direction = Class.forName("net.minecraft.core.Direction");
    var reader = Class.forName("net.minecraft.world.level.LevelReader");
    var ticks = Class.forName("net.minecraft.world.level.ScheduledTickAccess");
    var random = Class.forName("net.minecraft.util.RandomSource");
    var parser = Class.forName("net.minecraft.commands.arguments.blocks.BlockStateParser");
    var registries = Class.forName("net.minecraft.core.registries.BuiltInRegistries");
    var registry = registries.getField("BLOCK").get(null);
    var lookup = Class.forName("net.minecraft.core.HolderLookup");
    var parse = parser.getMethod("parseForBlock", lookup, String.class, boolean.class);
    var serialize = parser.getMethod("serialize", nativeState);
    var parsedState = Class.forName(parser.getName() + "$BlockResult").getMethod("blockState");
    var palette = new ArrayList<Object>();
    for (var state : input.palette()) {
      palette.add(parsedState.invoke(parse.invoke(null, registry, state, false)));
    }
    var air = parsedState.invoke(parse.invoke(null, registry, "minecraft:air", false));
    var xMethod = position.getMethod("getX");
    var yMethod = position.getMethod("getY");
    var zMethod = position.getMethod("getZ");
    var states = new TreeMap<Integer, Object>();
    var candidates = new ArrayList<Integer>();
    // Top down lets stacked walls observe the final wall above them in the same pass.
    for (var i = input.blockCount() - 1; i >= 0; i--) {
      if (!derived(input.palette().get(input.paletteIndexAt(i))).isEmpty()) candidates.add(i);
    }
    var view = new StateView(input, palette, states, air, List.of(xMethod, yMethod, zMethod));
    var level =
        Proxy.newProxyInstance(
            reader.getClassLoader(),
            new Class<?>[] {reader},
            (_, method, args) -> {
              if (!method.getName().equals("getBlockState"))
                throw new IllegalStateException("Unexpected native shape read: " + method);
              return view.read(java.util.Objects.requireNonNull(args)[0]);
            });
    var noTicks =
        Proxy.newProxyInstance(
            ticks.getClassLoader(),
            new Class<?>[] {ticks},
            (_, method, _) -> {
              // Waterlogged shape rules request water ticks. Conversion deliberately simulates
              // none.
              if (!method.getName().equals("scheduleTick"))
                throw new IllegalStateException("Unexpected native shape write: " + method);
              return null;
            });
    var update =
        nativeState.getMethod(
            "updateShape", reader, ticks, position, direction, position, nativeState, random);
    var relative = position.getMethod("relative", direction);
    var getState = reader.getMethod("getBlockState", position);
    var constructor = position.getConstructor(int.class, int.class, int.class);
    var randomSource = random.getMethod("create", long.class).invoke(null, 0L);
    var directions = List.of((Object[]) direction.getMethod("values").invoke(null));
    stabilize(
        input,
        view,
        candidates,
        new ShapeUpdate(
            update, relative, getState, constructor, randomSource, directions, level, noTicks));
    return encode(input, states, serialize);
  }

  private record StateView(
      Schematic input,
      List<Object> palette,
      Map<Integer, Object> states,
      Object air,
      List<Method> coordinates) {
    Object state(int index) {
      return states.getOrDefault(index, palette.get(input.paletteIndexAt(index)));
    }

    Object read(Object at) throws ReflectiveOperationException {
      var x = (int) coordinates.get(0).invoke(at);
      var y = (int) coordinates.get(1).invoke(at);
      var z = (int) coordinates.get(2).invoke(at);
      if (x < 0
          || y < 0
          || z < 0
          || x >= input.width()
          || y >= input.height()
          || z >= input.length()) return air;
      return state(input.index(x, y, z));
    }
  }

  private record ShapeUpdate(
      Method update,
      Method relative,
      Method getState,
      Constructor<?> position,
      Object random,
      List<Object> directions,
      Object level,
      Object noTicks) {
    Object at(Schematic input, int index, Object before) throws ReflectiveOperationException {
      var after = before;
      var at =
          position.newInstance(
              index % input.width(),
              index / input.width() / input.length(),
              index / input.width() % input.length());
      for (var face : directions) {
        var neighbor = relative.invoke(at, face);
        var neighborState = getState.invoke(level, neighbor);
        after = update.invoke(after, level, noTicks, at, face, neighbor, neighborState, random);
      }
      return after;
    }
  }

  private static void stabilize(
      Schematic input, StateView view, List<Integer> candidates, ShapeUpdate update)
      throws ReflectiveOperationException {
    for (var pass = 0; pass <= input.height() + 1; pass++) {
      var stable = true;
      for (var index : candidates) {
        var before = view.state(index);
        var after = update.at(input, index, before);
        if (!after.equals(before)) {
          view.states().put(index, after);
          stable = false;
        }
      }
      if (stable) return;
    }
    throw new IllegalStateException("Native map connections did not converge");
  }

  private static Result encode(Schematic input, Map<Integer, Object> states, Method serialize)
      throws ReflectiveOperationException {
    var outputPalette = new ArrayList<>(input.palette());
    var byState = new HashMap<String, Integer>();
    for (var i = 0; i < outputPalette.size(); i++) byState.put(outputPalette.get(i), i);
    var indices = new int[input.blockCount()];
    for (var i = 0; i < indices.length; i++) indices[i] = input.paletteIndexAt(i);
    var changed = 0;
    for (var entry : states.entrySet()) {
      var index = entry.getKey();
      var before = input.palette().get(input.paletteIndexAt(index));
      var after = (String) serialize.invoke(null, entry.getValue());
      if (!authored(before, derived(before)).equals(authored(after, derived(before))))
        throw new IllegalStateException(
            "Native conversion changed authored properties at " + index);
      if (before.equals(after)) continue;
      changed++;
      var paletteIndex = byState.get(after);
      if (paletteIndex == null) {
        paletteIndex = outputPalette.size();
        outputPalette.add(after);
        byState.put(after, paletteIndex);
      }
      indices[index] = paletteIndex;
    }
    return new Result(new Schematic(input.size(), outputPalette, indices), changed);
  }
}
