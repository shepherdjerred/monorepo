package com.shepherdjerred.castlecasters.game.objects.game.map;

import com.shepherdjerred.castlecasters.engine.graphics.RendererCoordinate;
import com.shepherdjerred.castlecasters.engine.graphics.matrices.ModelMatrix;
import com.shepherdjerred.castlecasters.engine.graphics.mesh.Mesh;
import com.shepherdjerred.castlecasters.engine.graphics.mesh.TexturedMesh;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgram;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgramName;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderUniform;
import com.shepherdjerred.castlecasters.engine.graphics.texture.Texture;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;
import com.shepherdjerred.castlecasters.engine.map.Layer;
import com.shepherdjerred.castlecasters.engine.map.MapTile;
import com.shepherdjerred.castlecasters.engine.object.GameObjectRenderer;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.extern.log4j.Log4j2;

import java.util.HashMap;
import java.util.Map;

import static com.shepherdjerred.castlecasters.game.Constants.RENDER_TILE_RESOLUTION;

@Log4j2
public class MapRenderer implements GameObjectRenderer<MapObject> {

  private final ResourceManager resourceManager;
  private final Map<MapTile, TexturedMesh> meshes;
  private ShaderProgram shaderProgram;
  private MapObject map;


  public MapRenderer(ResourceManager resourceManager) {
    this.resourceManager = resourceManager;
    meshes = new HashMap<>();
  }

  @Override
  public void initialize(MapObject map) throws Exception {
    this.map = map;
    shaderProgram = resourceManager.get(ShaderProgramName.DEFAULT);

    for (Layer layer : map.getMapLayers()) {
      for (MapTile tile : layer) {
        if (tile.textureName() == null) {
          log.info(tile);
        }

        var vertices = new float[]{
            0, 0, 0,
            0, RENDER_TILE_RESOLUTION, 0,
            RENDER_TILE_RESOLUTION, 0, 0,
            RENDER_TILE_RESOLUTION, RENDER_TILE_RESOLUTION, 0
        };

        var indices = new int[]{
            0, 1, 2,
            3, 1, 2
        };

        var mesh = new Mesh(vertices, tile.textureSheetCoordinates().asIndexedFloatArray(), indices);
        Texture texture = resourceManager.get(tile.textureName());
        var texturedMesh = new TexturedMesh(mesh, texture);

//        log.info(String.format("T: %s, C: %s", texture.getTextureName(), tile.getTextureSheetCoordinates()));

        meshes.put(tile, texturedMesh);
      }
    }

  }

  @Override
  public void render(WindowSize windowSize, MapObject map) {
    shaderProgram.bind();

    map.getMapLayers().forEach(layer -> layer.forEach(tile -> {
      var x = tile.position().x();
      var y = tile.position().y();

      var model = new ModelMatrix(new RendererCoordinate(x * RENDER_TILE_RESOLUTION + map.getXOffset(),
          y * RENDER_TILE_RESOLUTION + map.getYOffset(),
          layer.getZ() * -1),
          0,
          1).getMatrix();

      shaderProgram.setUniform(ShaderUniform.MODEL_MATRIX, model);

      var mesh = meshes.get(tile);
      mesh.render();
    }));

    shaderProgram.unbind();
  }

  @Override
  public void cleanup() {
    for (TextureName textureName : map.getMapLayers().getTextureNames()) {
      resourceManager.free(textureName);
    }
    meshes.values().forEach(texturedMesh -> {
      resourceManager.free(texturedMesh.texture().textureName());
      texturedMesh.mesh().cleanup();
      texturedMesh.texture().cleanup();
    });
    resourceManager.free(shaderProgram.getShaderProgramName());

  }
}
