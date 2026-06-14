export type TextureManifestEntry = {
  id: string;
  url: string;
  width: number;
  height: number;
};

export type TilesetManifestEntry = {
  textureId: string;
};

export type AssetManifest = {
  textures: TextureManifestEntry[];
  tilesets: TilesetManifestEntry[];
  maps: Record<string, string>;
  animations: Record<string, { textureId: string; frameWidth: number; frameHeight: number; frameCount: number; framesPerSecond: number }>;
};

export const assetBase = "/assets/castle-casters";

export const assetManifest: AssetManifest = {
  textures: [
    { id: "animations/ice", url: `${assetBase}/textures/tilesheets/animations/ice.png`, width: 320, height: 512 },
    { id: "characters/chests", url: `${assetBase}/textures/tilesheets/characters/chests.png`, width: 504, height: 288 },
    { id: "darkdimension/tf_darkdimension_sheet", url: `${assetBase}/textures/tilesheets/darkdimension/tf_darkdimension_sheet.png`, width: 464, height: 336 },
    { id: "main/animated/torch", url: `${assetBase}/textures/tilesheets/main/animated/torch.png`, width: 48, height: 80 },
    { id: "main/castle", url: `${assetBase}/textures/tilesheets/main/castle.png`, width: 544, height: 272 },
    { id: "main/desert", url: `${assetBase}/textures/tilesheets/main/desert.png`, width: 288, height: 368 },
    { id: "main/terrain", url: `${assetBase}/textures/tilesheets/main/terrain.png`, width: 624, height: 608 },
    { id: "main/water", url: `${assetBase}/textures/tilesheets/main/water.png`, width: 816, height: 880 },
    { id: "ruins/tf_B_ruins1", url: `${assetBase}/textures/tilesheets/ruins/tf_B_ruins1.png`, width: 256, height: 256 },
    { id: "winter/tf_winter_terrain", url: `${assetBase}/textures/tilesheets/winter/tf_winter_terrain.png`, width: 640, height: 352 },
    { id: "winter/tf_winter_tileB", url: `${assetBase}/textures/tilesheets/winter/tf_winter_tileB.png`, width: 256, height: 256 },
    { id: "winter/tf_winter_tileC", url: `${assetBase}/textures/tilesheets/winter/tf_winter_tileC.png`, width: 256, height: 256 },
    { id: "wizard-fire-front", url: `${assetBase}/textures/wizards/front_fire.png`, width: 32, height: 96 },
    { id: "wizard-ice-front", url: `${assetBase}/textures/wizards/front_frost.png`, width: 32, height: 96 },
    { id: "wizard-earth-front", url: `${assetBase}/textures/wizards/front_earth.png`, width: 32, height: 96 },
    { id: "wizard-wind-front", url: `${assetBase}/textures/wizards/front_air.png`, width: 32, height: 96 },
    { id: "wall-fire", url: `${assetBase}/textures/walls/wall_fire.png`, width: 128, height: 160 },
    { id: "background-purple", url: `${assetBase}/textures/ui/backgrounds/purple mountains.png`, width: 1920, height: 1080 },
  ],
  tilesets: [],
  maps: {
    grass: `${assetBase}/maps/grass.json`,
    grassBig: `${assetBase}/maps/grass11x11.json`,
    grassSmall: `${assetBase}/maps/grass7x7.json`,
    desert: `${assetBase}/maps/desert.json`,
    desertBig: `${assetBase}/maps/desert7x7.json`,
    desertSmall: `${assetBase}/maps/desert11x11.json`,
    winter: `${assetBase}/maps/winter.json`,
    winterBig: `${assetBase}/maps/winter7x7.json`,
    winterSmall: `${assetBase}/maps/winter11x11.json`,
    test: `${assetBase}/maps/test.json`,
  },
  animations: {
    "wizard-fire-front": { textureId: "wizard-fire-front", frameWidth: 32, frameHeight: 32, frameCount: 3, framesPerSecond: 6 },
    "wizard-ice-front": { textureId: "wizard-ice-front", frameWidth: 32, frameHeight: 32, frameCount: 3, framesPerSecond: 6 },
    "wizard-earth-front": { textureId: "wizard-earth-front", frameWidth: 32, frameHeight: 32, frameCount: 3, framesPerSecond: 6 },
    "wizard-wind-front": { textureId: "wizard-wind-front", frameWidth: 32, frameHeight: 32, frameCount: 3, framesPerSecond: 6 },
  },
};
