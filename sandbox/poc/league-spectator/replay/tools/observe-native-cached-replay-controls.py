"""Observe replay actions with the original binary-resource cache constructed.

The prior archived/bootstrap and launched observers remain unchanged. This adds
only the exact original constructor for the null owner read at14be2e5; no UI
scene, widget reference, class registry, or native readiness field is supplied.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import champion_catalog_native
from unicorn import x86_const as r

launched_path = Path(__file__).with_name("observe-native-launched-replay-controls.py")
spec = importlib.util.spec_from_file_location("cached_replay_launched_observer", launched_path)
launched = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = launched
spec.loader.exec_module(launched)


def main():
    sources = {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in [Path(__file__), launched_path, Path(champion_catalog_native.__file__)]}
    previous = launched.observer.observe

    def observe_cached(n):
        try:
            launched.observer.observations["originalBinaryCache"] = champion_catalog_native.initialize_binary_resource_cache(n)
        except Exception as error:
            launched.observer.observations.update(phase="original-binary-resource-cache-constructor",
                boundary={"phase": "original-binary-resource-cache-constructor", "kind": type(error).__name__,
                    "message": str(error), "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base})
            return
        previous(n)

    launched.observer.observe = observe_cached
    failure = None
    try:
        launched.main()
    except SystemExit as error:
        failure = error
    finally:
        for filename, digest in sources.items():
            if hashlib.sha256(Path(filename).read_bytes()).hexdigest() != digest:
                raise ValueError("Cached native-control observer source changed during execution")
        output = Path(sys.argv[-1])
        if output.exists():
            report = json.loads(output.read_bytes())
            report["additionalPrerequisiteSources"] = sources
            output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if failure is not None:
        raise failure


if __name__ == "__main__":
    main()
