package com.shepherdjerred.castlecasters.engine.resource;

import com.shepherdjerred.castlecasters.engine.audio.AudioName;
import com.shepherdjerred.castlecasters.engine.graphics.font.FontName;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;
import com.shepherdjerred.castlecasters.engine.map.GameMapName;
import lombok.ToString;
import lombok.extern.log4j.Log4j2;

import java.util.HashMap;

import static com.shepherdjerred.castlecasters.engine.graphics.font.FontName.FIRA_CODE;
import static com.shepherdjerred.castlecasters.engine.graphics.font.FontName.M5X7;
import static com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName.*;

/**
 * Returns the path to a texture file.
 */
@Log4j2
@ToString
public class PathResourceFileLocator implements ResourceFileLocator {

  private final String texturesBasePath;
  private final String fontsBasePath;
  private final String audioBasePath;
  private final String mapBasePath;
  private final HashMap<ResourceIdentifier, String> resourcePaths;

  public PathResourceFileLocator(String texturesBasePath,
                                 String fontsBasePath,
                                 String audioBasePath,
                                 String mapBasePath) {
    this.texturesBasePath = texturesBasePath;
    this.fontsBasePath = fontsBasePath;
    this.audioBasePath = audioBasePath;
    this.mapBasePath = mapBasePath;

    resourcePaths = new HashMap<>();

    initializeTexturePaths();
    initializeFontPaths();
    initializeAudioPaths();
    initializeMapPaths();
  }

  private void initializeMapPaths() {
    resourcePaths.put(GameMapName.GRASS, "grass.json");
    resourcePaths.put(GameMapName.DESERT, "desert.json");
    resourcePaths.put(GameMapName.WINTER, "winter.json");
  }

  private void initializeAudioPaths() {
    resourcePaths.put(AudioName.THEME_MUSIC, "music/theme.ogg");
    resourcePaths.put(AudioName.VICTORY_MUSIC, "music/victory.ogg");
    resourcePaths.put(AudioName.DEFEAT_MUSIC, "music/defeat.ogg");
  }

  private void initializeTexturePaths() {
    resourcePaths.put(ICE_WALL, "walls/wall_frost.png");
    resourcePaths.put(EARTH_WALL, "walls/wall_earth_elem.png");
    resourcePaths.put(FIRE_WALL, "walls/wall_fire_elem.png");
    resourcePaths.put(AIR_WALL, "walls/wall_air_elem.png");
    resourcePaths.put(FIRE_WIZARD_FRONT, "wizards/front_fire.png");
    resourcePaths.put(FIRE_WIZARD_BACK, "wizards/back_fire.png");
    resourcePaths.put(FIRE_WIZARD_SIDE, "wizards/side_fire.png");
    resourcePaths.put(FIRE_WIZARD_CAST, "wizards/cast_fire.png");
    resourcePaths.put(TERRAIN_TILESHEET, "tilesheets/main/terrain.png");
    resourcePaths.put(CASTLE_TILESHEET, "tilesheets/main/castle.png");
    resourcePaths.put(DESERT_TILESHEET, "tilesheets/main/desert.png");
    resourcePaths.put(WATER_TILESHEET, "tilesheets/main/water.png");
    resourcePaths.put(WINTER_TILE_B_TILESHEET, "tilesheets/winter/tf_winter_tileB.png");
    resourcePaths.put(WINTER_TILE_C_TILESHEET, "tilesheets/winter/tf_winter_tileC.png");
    resourcePaths.put(DARK_DIMENSION_TILESHEET, "tilesheets/darkdimension/tf_darkdimension_sheet.png");
    resourcePaths.put(WINTER_TERRAIN_TILESHEET, "tilesheets/winter/tf_winter_terrain.png");
    resourcePaths.put(TORCH_TILESHEET, "tilesheets/main/animated/torch.png");
    resourcePaths.put(ICE_TILESHEET, "tilesheets/animations/ice.png");
    resourcePaths.put(CHESTS_TILESHEET, "tilesheets/characters/chests.png");
    resourcePaths.put(B_RUINS_1_TILESHEET, "tilesheets/ruins/tf_B_ruins1.png");
    resourcePaths.put(MAIN_MENU_BUTTON, "ui/buttons/main-menu-default.png");
    resourcePaths.put(MAIN_MENU_BUTTON_HOVERED,
        "ui/buttons/main-menu-hovered.png");
    resourcePaths.put(MAIN_MENU_BUTTON_CLICKED,
        "ui/buttons/main-menu-active.png");
    resourcePaths.put(PURPLE_MOUNTAINS, "ui/backgrounds/purple mountains.png");
    resourcePaths.put(PURPLE_MOUNTAINS_A,
        "ui/backgrounds/parallax/purple-mountains/purple-mountains-a.png");
    resourcePaths.put(PURPLE_MOUNTAINS_B,
        "ui/backgrounds/parallax/purple-mountains/purple-mountains-b.png");
    resourcePaths.put(PURPLE_MOUNTAINS_C,
        "ui/backgrounds/parallax/purple-mountains/purple-mountains-c.png");
    resourcePaths.put(PURPLE_MOUNTAINS_D,
        "ui/backgrounds/parallax/purple-mountains/purple-mountains-d.png");
    resourcePaths.put(PURPLE_MOUNTAINS_E,
        "ui/backgrounds/parallax/purple-mountains/purple-mountains-e.png");
    resourcePaths.put(PLAINS_A,
        "ui/backgrounds/parallax/plains/plains-a.png");
    resourcePaths.put(PLAINS_B,
        "ui/backgrounds/parallax/plains/plains-b.png");
    resourcePaths.put(PLAINS_C,
        "ui/backgrounds/parallax/plains/plains-c.png");
    resourcePaths.put(PLAINS_D,
        "ui/backgrounds/parallax/plains/plains-d.png");
    resourcePaths.put(PLAINS_E,
        "ui/backgrounds/parallax/plains/plains-e.png");
    resourcePaths.put(CEMETERY_A,
        "ui/backgrounds/parallax/cemetery/cemetery-a.png");
    resourcePaths.put(CEMETERY_B,
        "ui/backgrounds/parallax/cemetery/cemetery-b.png");
    resourcePaths.put(CEMETERY_C,
        "ui/backgrounds/parallax/cemetery/cemetery-c.png");
    resourcePaths.put(CEMETERY_D,
        "ui/backgrounds/parallax/cemetery/cemetery-d.png");
    resourcePaths.put(CEMETERY_E,
        "ui/backgrounds/parallax/cemetery/cemetery-e.png");
    resourcePaths.put(CEMETERY_NIGHT_A,
        "ui/backgrounds/parallax/cemetery-night/cemetery-night-a.png");
    resourcePaths.put(CEMETERY_NIGHT_B,
        "ui/backgrounds/parallax/cemetery-night/cemetery-night-b.png");
    resourcePaths.put(CEMETERY_NIGHT_C,
        "ui/backgrounds/parallax/cemetery-night/cemetery-night-c.png");
    resourcePaths.put(CEMETERY_NIGHT_D,
        "ui/backgrounds/parallax/cemetery-night/cemetery-night-d.png");
    resourcePaths.put(CEMETERY_NIGHT_E,
        "ui/backgrounds/parallax/cemetery-night/cemetery-night-e.png");
    resourcePaths.put(DESERT_A,
        "ui/backgrounds/parallax/desert/desert-a.png");
    resourcePaths.put(DESERT_B,
        "ui/backgrounds/parallax/desert/desert-b.png");
    resourcePaths.put(DESERT_C,
        "ui/backgrounds/parallax/desert/desert-c.png");
    resourcePaths.put(DESERT_D,
        "ui/backgrounds/parallax/desert/desert-d.png");
    resourcePaths.put(DESERT_E,
        "ui/backgrounds/parallax/desert/desert-e.png");
    resourcePaths.put(DESERT_RED_A,
        "ui/backgrounds/parallax/desert-red/desert-red-a.png");
    resourcePaths.put(DESERT_RED_B,
        "ui/backgrounds/parallax/desert-red/desert-red-b.png");
    resourcePaths.put(DESERT_RED_C,
        "ui/backgrounds/parallax/desert-red/desert-red-c.png");
    resourcePaths.put(DESERT_RED_D,
        "ui/backgrounds/parallax/desert-red/desert-red-d.png");
    resourcePaths.put(DESERT_RED_E,
        "ui/backgrounds/parallax/desert-red/desert-red-e.png");
    resourcePaths.put(GREEN_FOREST_A,
        "ui/backgrounds/parallax/green-forest/green-forest-a.png");
    resourcePaths.put(GREEN_FOREST_B,
        "ui/backgrounds/parallax/green-forest/green-forest-b.png");
    resourcePaths.put(GREEN_FOREST_C,
        "ui/backgrounds/parallax/green-forest/green-forest-c.png");
    resourcePaths.put(GREEN_MOUNTAINS_A,
        "ui/backgrounds/parallax/green-mountains/green-mountains-a.png");
    resourcePaths.put(GREEN_MOUNTAINS_B,
        "ui/backgrounds/parallax/green-mountains/green-mountains-b.png");
    resourcePaths.put(GREEN_MOUNTAINS_C,
        "ui/backgrounds/parallax/green-mountains/green-mountains-c.png");
    resourcePaths.put(GREEN_MOUNTAINS_D,
        "ui/backgrounds/parallax/green-mountains/green-mountains-d.png");
    resourcePaths.put(GREEN_MOUNTAINS_E,
        "ui/backgrounds/parallax/green-mountains/green-mountains-e.png");
    resourcePaths.put(NIGHT_FOREST_A,
        "ui/backgrounds/parallax/night-forest/night-forest-a.png");
    resourcePaths.put(NIGHT_FOREST_B,
        "ui/backgrounds/parallax/night-forest/night-forest-b.png");
    resourcePaths.put(NIGHT_FOREST_C,
        "ui/backgrounds/parallax/night-forest/night-forest-c.png");
    resourcePaths.put(RED_PLAINS_A,
        "ui/backgrounds/parallax/red-plains/red-plains-a.png");
    resourcePaths.put(RED_PLAINS_B,
        "ui/backgrounds/parallax/red-plains/red-plains-b.png");
    resourcePaths.put(RED_PLAINS_C,
        "ui/backgrounds/parallax/red-plains/red-plains-c.png");
    resourcePaths.put(RED_PLAINS_D,
        "ui/backgrounds/parallax/red-plains/red-plains-d.png");
    resourcePaths.put(RED_PLAINS_E,
        "ui/backgrounds/parallax/red-plains/red-plains-e.png");
    resourcePaths.put(GAME_LOGO, "logos/game logo.png");
    resourcePaths.put(TEAM_LOGO, "logos/team logo.png");
    resourcePaths.put(UNKNOWN, "unknown.png");
    resourcePaths.put(GENERIC_BUTTON, "ui/buttons/black.png");
    resourcePaths.put(GENERIC_BUTTON_HOVERED, "ui/buttons/black_hovered.png");
    resourcePaths.put(GENERIC_BUTTON_CLICKED, "ui/buttons/black_clicked.png");
  }

  private void initializeFontPaths() {
    resourcePaths.put(M5X7, "m5x7.ttf");
    resourcePaths.put(FIRA_CODE, "FiraCode-Regular.ttf");
  }

  @Override
  public String getTexturePath(TextureName textureName) {
    return getResourcePath(texturesBasePath, textureName);
  }

  @Override
  public String getFontPath(FontName fontName) {
    return getResourcePath(fontsBasePath, fontName);
  }

  @Override
  public String getAudioPath(AudioName audioName) {
    return getResourcePath(audioBasePath, audioName);
  }

  @Override
  public String getMapPath(GameMapName mapName) {
    return getResourcePath(mapBasePath, mapName);
  }

  private String getResourcePath(String basePath, ResourceIdentifier name) {
    if (resourcePaths.containsKey(name)) {
      return basePath + resourcePaths.get(name);
    } else {
      throw new IllegalStateException("Could not find resource: " + name);
    }
  }
}
