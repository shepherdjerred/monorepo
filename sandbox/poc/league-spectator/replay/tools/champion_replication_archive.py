"""Read the exact archived Mac x86 image for the replay replication probes."""

from hashlib import sha256

from macho import MachImage

ARCHIVED_BUILD = "16.23.840.6595"
CURRENT_BUILD = "16.23.841.8428"
SLICE_DIGESTS = {
    ARCHIVED_BUILD: "e4725bce602c14f5999ec83fae12eec239337caf77bdd5efacfe1b6299dec2aa",
    CURRENT_BUILD: "de6db1683eb61358d0aaf9fac44ef722850a927263eae7f68212add8621a500e",
}
CURRENT_ARCHIVE_SHA256 = "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"


def read_replication_image(archive, build):
    if build not in SLICE_DIGESTS:
        raise ValueError("Unreviewed champion replication build")
    if build == CURRENT_BUILD and sha256(archive).hexdigest() != CURRENT_ARCHIVE_SHA256:
        raise ValueError("Wrong current champion replication archive")
    image = MachImage(archive)
    if sha256(image.binary).hexdigest() != SLICE_DIGESTS[build]:
        raise ValueError("Wrong archived champion replication decoder")
    return image
