"""Texture paths from original typed string fields, including constructor defaults."""
def discover_native_texture_paths(native,graph):
    paths={};seen=set()
    for visit in graph['visits']:
        identity=(visit['type'],visit['object'])
        if identity in seen:continue
        seen.add(identity);descriptor=native.type_catalog[f"{visit['type']:08x}"]
        for field in descriptor['properties']:
            if field['type']!=16:continue
            if field['offset']+16>visit['bytes']:
                raise ValueError('Native string field exceeds its typed instance')
            at=visit['object']+field['offset'];length=native.u32(at+8)
            if length==0:continue
            if length>4096 or not native.library_pointer(native.q(at),length):
                raise ValueError('Native texture-discovery string exceeds owned graph')
            value=bytes(native.u.mem_read(native.q(at),length)).decode('utf-8')
            if value.lower().endswith(('.tex','.dds')):
                key=value.lower()
                paths.setdefault(key,{'path':value,'fields':[]})['fields'].append({
                    'object':visit['object'],'type':visit['type'],'offset':field['offset']})
    return list(paths.values())
