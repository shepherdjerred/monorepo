package com.shepherdjerred.castlecasters.game.objects.background.parallax;

import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.AbstractSceneBackground;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.Getter;
import lombok.ToString;

import java.util.Random;
import java.util.SortedMap;
import java.util.TreeMap;

/**
 * A background spanning the entire window.
 */
@ToString
public class ParallaxBackground extends AbstractSceneBackground {

  @Getter
  private final Type type;
  @Getter
  private final SortedMap<Integer, SortedMap<Integer, Float>> instances;
  private final ParallaxBackgroundData parallaxBackgroundData;

  public ParallaxBackground(ResourceManager resourceManager, WindowSize windowSize, Type type) {
    super(new ParallaxBackgroundRenderer(resourceManager, windowSize), windowSize);
    this.type = type;
    this.instances = new TreeMap<>();
    var texturesMapper = new ParallaxTexturesMapper();

    instances.put(1, new TreeMap<>());
    instances.put(2, new TreeMap<>());

    parallaxBackgroundData = texturesMapper.get(type);
    var numLayers = parallaxBackgroundData.getNumberOfLayers();

    for (int i = 1; i <= numLayers; i++) {
      instances.get(1).put(i, 0f);
    }

    for (int i = 1; i <= numLayers; i++) {
      instances.get(2).put(i, 1f);
    }
  }

  public void moveLayer(int instance, int layer, float newPosition) {
    if (newPosition < -1) {
      newPosition = 1;
    }
    if (newPosition > 1) {
      newPosition = -1;
    }
    instances.get(instance).put(layer, newPosition);
  }

  public float getLayerPosition(int instance, int layer) {
    return instances.get(instance).get(layer);
  }

  @Override
  public SceneObjectDimensions getSceneObjectDimensions() {
    return new SceneObjectDimensions(0, 0);
  }

  @Override
  public void update(float interval) {
    var spread = 4;
    var minifier = .000001;
    instances.forEach((instance, layers) -> layers.forEach((layer, pos) -> {
      if (!parallaxBackgroundData.getLayerData(layer).isStatic()) {
        moveLayer(instance, layer, (float) (pos - ((Math.pow(layer, spread)) * minifier)));
      }
    }));
  }

  public enum Type {
    CEMETERY,
    CEMETERY_NIGHT,
    DESERT,
    DESERT_RED,
    GREEN_FOREST,
    GREEN_MOUNTAINS,
    NIGHT_FOREST,
    PLAINS,
    PURPLE_MOUNTAINS,
    RED_PLAINS;

    public static Type random() {
      var random = new Random();
      var values = Type.values();
      return values[random.nextInt(values.length)];
    }
  }
}
