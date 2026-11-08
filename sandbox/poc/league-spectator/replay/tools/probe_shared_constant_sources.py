"""Source dependencies borrowed by the installed shared-constant control."""
import inspect
from pathlib import Path
from vfx_graphics_native import NativeVfxGraphicsContext
from vfx_pipeline_native import NativeVfxPipelineContext
from vfx_mesh_native import NativeVfxMeshContext
from graphics_texture_device import GraphicsTextureDevice
from graphics_mesh_device import GraphicsMeshDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from graphics_pipeline_device import GraphicsPipelineDevice
from graphics_material_bindings import GraphicsMaterialBindings


def borrowed_sources():
    return {Path(__file__),*[Path(inspect.getfile(c)) for c in [NativeVfxGraphicsContext,NativeVfxPipelineContext,
        NativeVfxMeshContext,GraphicsTextureDevice,GraphicsMeshDevice,GraphicsShaderCatalog,GraphicsPipelineDevice,GraphicsMaterialBindings]],
        *[Path(__file__).with_name(name) for name in ['render-particle-shader.py','observe-shader-angle.py',
            'graphics_block_texture_device.py','native_block_texture_upload.py','libcpp_string_native.py']]}
