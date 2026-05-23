package com.shepherdjerred.castlecasters.engine.map;

import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;
import com.shepherdjerred.castlecasters.engine.resource.Resource;
import lombok.Getter;
import lombok.ToString;

import java.util.*;

@Getter
@ToString
public class MapLayers implements Resource, Iterable<Layer> {

  private final MapDimensions dimension;
  private final SortedMap<Integer, Layer> layerMap;
  private final Set<TextureName> textureNames;

  public MapLayers(MapDimensions mapDimensions) {
    this.dimension = mapDimensions;
    this.textureNames = new LinkedHashSet<>();
    layerMap = new TreeMap<>();
  }

  public void setLayer(Integer i, Layer layer) {
    if (layerMap.containsKey(i)) {
      throw new IllegalArgumentException("Map already contains layer at this z");
    }
    layerMap.put(i, layer);
    textureNames.addAll(layer.getLayerTextures());
  }

  public Layer getLayer(Integer i) {
    return layerMap.get(i);
  }

  @Override
  public void cleanup() {

  }

  @Override
  public Iterator<Layer> iterator() {
    return layerMap.values().iterator();
  }
}
