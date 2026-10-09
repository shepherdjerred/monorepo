"""Certificates and checkpoints owned by the static overview publisher."""

from typing import NotRequired, TypedDict


class ToolPin(TypedDict):
    version: str
    url: str
    sha256: NotRequired[str]
    sha1: NotRequired[str]


class UpgraderPin(ToolPin):
    dataVersion: int


class ToolConfig(TypedDict):
    release: str
    bluemap: ToolPin
    upgrader: UpgraderPin
    webapp: ToolPin
    javaImage: str
    upgraderPatchSha256: str
    rendererPatchSha256: str


class VersionedWorld(TypedDict):
    minecraft: str


class NamedWorld(TypedDict):
    id: str
    title: str


class Asset(TypedDict):
    path: str
    bytes: int
    sha256: str


class Checkpoint(TypedDict):
    phase: str
    sourceSha256: str
    spawn: list[int]
    chunks: int
    generatedChunksRemoved: int
    assets: list[Asset]


class PublishedOverview(TypedDict):
    sourceSha256: str
    renderMinecraft: str
    url: str
    chunks: int
    generatedChunksRemoved: int
    bytes: int
    objects: int
    assets: list[Asset]


class OverviewPublication(TypedDict):
    archiveRelease: str
    overviewRelease: str
    tools: ToolConfig
    worlds: dict[str, PublishedOverview]


TerrainInventory = dict[str, list[int]]
