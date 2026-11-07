"""Memoize original block validation beneath all existing observer overrides.

This changes host evidence bookkeeping only. Original game instructions and all
platform services still execute. Place this mixin immediately before NativeSpawn
in the cooperative MRO so boundary exclusions and per-phase observations above
it continue to run on every block, including cache hits.
"""
from vfx_spawn_native import NativeSpawn, SERVICES


class NativePristineBlockCache:
    def __init__(self, *args, **kwargs):
        self.pristine_block_cache = None
        super().__init__(*args, **kwargs)
        self.initialize_pristine_block_cache()

    def initialize_pristine_block_cache(self):
        order = type(self).__mro__
        index = order.index(NativePristineBlockCache)
        if order[index + 1] is not NativeSpawn:
            raise ValueError('Pristine cache must immediately precede NativeSpawn in the observer MRO')
        if self.pristine_block_cache is not None:
            raise ValueError('Pristine block cache already initialized')
        if not isinstance(self.image, bytes):
            raise ValueError('Prepared native image must be immutable bytes')
        # MachImage builds its pristine image as a bytearray. All subsequent
        # users are read-only; freeze the same bytes before memoizing comparisons.
        self.source.image = bytes(self.source.image)
        self.pristine_block_images = (self.image, self.source.image)
        self.pristine_block_cache = {}
        self.pristine_block_cache_hits = 0
        self.pristine_block_cache_misses = 0
        self.pristine_block_cache_passthrough = 0

    def check_block(self, engine, address, size, user):
        if self.pristine_block_cache is None:
            return super().check_block(engine, address, size, user)
        prepared, pristine = self.pristine_block_images
        if (not isinstance(self.image, bytes) or not isinstance(self.source.image, bytes) or
                self.image is not prepared or self.source.image is not pristine):
            raise ValueError('Native block-cache source images changed after freezing')
        key = (address - self.base, size)
        if key[0] in SERVICES or key[0] in self.source.imports:
            self.pristine_block_cache_passthrough += 1
            return super().check_block(engine, address, size, user)
        row = self.pristine_block_cache.get(key)
        if row is not None:
            self.pristine_block_cache_hits += 1
            self.blocks[key[0]] = row
            return
        # Preserve NativeSpawn's service/import boundaries and original mismatch
        # exception. Excluded modeled blocks never acquire a validated entry.
        super().check_block(engine, address, size, user)
        row = self.blocks.get(key[0])
        if row is not None and row['rva'] == key[0] and row['size'] == size:
            self.pristine_block_cache[key] = row
            self.pristine_block_cache_misses += 1
        else:
            self.pristine_block_cache_passthrough += 1

    def pristine_block_cache_statistics(self):
        return {'validatedBlockSizes': len(self.pristine_block_cache),
                'hits': self.pristine_block_cache_hits,
                'misses': self.pristine_block_cache_misses,
                'boundaryPassthrough': self.pristine_block_cache_passthrough,
                'scope': {'hostBookkeepingOnly': True,
                          'originalInstructionsReplaced': False,
                          'wholeProcessSnapshotRestored': False}}
