"""Exact POST_EFFECT resource-row adapter; distinct from world raster winding."""
import hashlib

POLICY = 'metal-upper-left-resource-rows-to-gles-clip-y-negated-v1'
ORIGINAL_VERTEX_SHA256 = '02fbee75855817ce9d7d2199b60a3416899b2e71e18359ac0bc9fd7aa572a2ee'
ADAPTED_VERTEX_SHA256 = '789b68ee7faab14b6ff2f54df81454d623badfdcde11d3a8987e74a66984612f'


def adapt_navmesh_resource_vertex(source):
    if not isinstance(source, str) or hashlib.sha256(source.encode()).hexdigest() != ORIGINAL_VERTEX_SHA256:
        raise ValueError('Exact original POST_EFFECT vertex shader required')
    original = '    gl_Position.y = _31;'
    if source.count(original) != 1:
        raise ValueError('Original fullscreen clip assignment differs')
    adapted = source.replace(original, '    gl_Position.y = -_31;')
    if hashlib.sha256(adapted.encode()).hexdigest() != ADAPTED_VERTEX_SHA256:
        raise ValueError('Resource-coordinate shader specialization differs')
    return adapted
