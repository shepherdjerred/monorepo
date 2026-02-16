package com.shepherdjerred.castlecasters.game.objects.background.parallax;

import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;

public class ParallaxTexturesMapper {

  public ParallaxBackgroundData get(ParallaxBackground.Type type) {
    ParallaxBackgroundData textures;

    switch (type) {
      case PURPLE_MOUNTAINS:
        textures = new ParallaxBackgroundData(5);
        textures.setLayerData(1, new LayerData(TextureName.PURPLE_MOUNTAINS_A, true));
        textures.setLayerData(2, new LayerData(TextureName.PURPLE_MOUNTAINS_B, false));
        textures.setLayerData(3, new LayerData(TextureName.PURPLE_MOUNTAINS_C, false));
        textures.setLayerData(4, new LayerData(TextureName.PURPLE_MOUNTAINS_D, false));
        textures.setLayerData(5, new LayerData(TextureName.PURPLE_MOUNTAINS_E, false));
        break;
      case PLAINS:
        textures = new ParallaxBackgroundData(5);
        textures.setLayerData(1, new LayerData(TextureName.PLAINS_A, true));
        textures.setLayerData(2, new LayerData(TextureName.PLAINS_B, true));
        textures.setLayerData(3, new LayerData(TextureName.PLAINS_C, false));
        textures.setLayerData(4, new LayerData(TextureName.PLAINS_D, false));
        textures.setLayerData(5, new LayerData(TextureName.PLAINS_E, false));
        break;
      case CEMETERY:
        textures = new ParallaxBackgroundData(5);
        textures.setLayerData(1, new LayerData(TextureName.CEMETERY_A, true));
        textures.setLayerData(2, new LayerData(TextureName.CEMETERY_B, false));
        textures.setLayerData(3, new LayerData(TextureName.CEMETERY_C, false));
        textures.setLayerData(4, new LayerData(TextureName.CEMETERY_D, false));
        textures.setLayerData(5, new LayerData(TextureName.CEMETERY_E, false));
        break;
      case CEMETERY_NIGHT:
        textures = new ParallaxBackgroundData(5);
        textures.setLayerData(1, new LayerData(TextureName.CEMETERY_NIGHT_A, true));
        textures.setLayerData(2, new LayerData(TextureName.CEMETERY_NIGHT_B, false));
        textures.setLayerData(3, new LayerData(TextureName.CEMETERY_NIGHT_C, false));
        textures.setLayerData(4, new LayerData(TextureName.CEMETERY_NIGHT_D, false));
        textures.setLayerData(5, new LayerData(TextureName.CEMETERY_NIGHT_E, false));
        break;
      case DESERT:
        textures = new ParallaxBackgroundData(5);
        textures.setLayerData(1, new LayerData(TextureName.DESERT_A, true));
        textures.setLayerData(2, new LayerData(TextureName.DESERT_B, false));
        textures.setLayerData(3, new LayerData(TextureName.DESERT_C, false));
        textures.setLayerData(4, new LayerData(TextureName.DESERT_D, false));
        textures.setLayerData(5, new LayerData(TextureName.DESERT_E, false));
        break;
      case DESERT_RED:
        textures = new ParallaxBackgroundData(5);
        textures.setLayerData(1, new LayerData(TextureName.DESERT_RED_A, true));
        textures.setLayerData(2, new LayerData(TextureName.DESERT_RED_B, false));
        textures.setLayerData(3, new LayerData(TextureName.DESERT_RED_C, false));
        textures.setLayerData(4, new LayerData(TextureName.DESERT_RED_D, false));
        textures.setLayerData(5, new LayerData(TextureName.DESERT_RED_E, false));
        break;
      case GREEN_FOREST:
        textures = new ParallaxBackgroundData(3);
        textures.setLayerData(1, new LayerData(TextureName.GREEN_FOREST_A, true));
        textures.setLayerData(2, new LayerData(TextureName.GREEN_FOREST_B, false));
        textures.setLayerData(3, new LayerData(TextureName.GREEN_FOREST_C, false));
        break;
      case GREEN_MOUNTAINS:
        textures = new ParallaxBackgroundData(5);
        textures.setLayerData(1, new LayerData(TextureName.GREEN_MOUNTAINS_A, true));
        textures.setLayerData(2, new LayerData(TextureName.GREEN_MOUNTAINS_B, false));
        textures.setLayerData(3, new LayerData(TextureName.GREEN_MOUNTAINS_C, false));
        textures.setLayerData(4, new LayerData(TextureName.GREEN_MOUNTAINS_D, false));
        textures.setLayerData(5, new LayerData(TextureName.GREEN_MOUNTAINS_E, false));
        break;
      case NIGHT_FOREST:
        textures = new ParallaxBackgroundData(3);
        textures.setLayerData(1, new LayerData(TextureName.NIGHT_FOREST_A, true));
        textures.setLayerData(2, new LayerData(TextureName.NIGHT_FOREST_B, false));
        textures.setLayerData(3, new LayerData(TextureName.NIGHT_FOREST_C, false));
        break;
      case RED_PLAINS:
        textures = new ParallaxBackgroundData(5);
        textures.setLayerData(1, new LayerData(TextureName.RED_PLAINS_A, true));
        textures.setLayerData(2, new LayerData(TextureName.RED_PLAINS_B, true));
        textures.setLayerData(3, new LayerData(TextureName.RED_PLAINS_C, false));
        textures.setLayerData(4, new LayerData(TextureName.RED_PLAINS_D, false));
        textures.setLayerData(5, new LayerData(TextureName.RED_PLAINS_E, false));
        break;
      default:
        throw new UnsupportedOperationException("Unknown type: " + type);
    }

    return textures;
  }
}
