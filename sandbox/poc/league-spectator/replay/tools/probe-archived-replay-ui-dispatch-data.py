"""Load original replay UI data with owned, caller-dispatched asset work.

The accepted graphics/bootstrap probes and their guards remain unchanged. The
original queue constructors initialize data only; no OS worker or readiness
value is synthesized. Synchronous native waits retain their CPU/stack context.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from original_asset_dispatch_native import initialize_original_asset_dispatch
from asset_wait_dispatch_native import NativeAssetWaitDispatch


driver_path = Path(__file__).with_name("probe-archived-replay-ui-graphics-data.py")
spec = importlib.util.spec_from_file_location("archived_ui_dispatch_graphics_probe", driver_path)
driver = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = driver
spec.loader.exec_module(driver)
dispatch = {}
base_class = driver.bootstrap.NativeArchivedReplayUiControl


class UiDispatchControl(base_class):
    def initialize_character_graphics(self, angle):
        result = super().initialize_character_graphics(angle)
        dispatch["initialization"] = initialize_original_asset_dispatch(self)
        self.ui_asset_wait_dispatch = NativeAssetWaitDispatch(self)
        return result

    def call(self, entry, registers, *args, **kwargs):
        if entry != 0x14BA7D0 or not hasattr(self, "ui_asset_wait_dispatch"):
            return super().call(entry, registers, *args, **kwargs)
        if args or kwargs:
            raise ValueError("Original whole UI loader requires its ordinary return boundary")
        waiter = self.ui_asset_wait_dispatch
        dispatch["queueBeforeLoader"] = self.asset_queue_state()
        try:
            waiter.call(entry, registers)
            dispatch["originalLoaderReturned"] = True
            returned_context = self.u.context_save()
            dispatch["queueBeforeDrain"] = self.asset_queue_state()
            try:
                self.drain_asset_read_jobs()
                dispatch["originalDrainReturned"] = True
            finally:
                # Draining invokes other original functions. Preserve the
                # caller-visible loader registers, including its return value.
                self.u.context_restore(returned_context)
        finally:
            dispatch["queueAfterLoader"] = self.asset_queue_state()

    def close_files(self):
        waiter = getattr(self, "ui_asset_wait_dispatch", None)
        if waiter is not None:
            dispatch["waits"] = waiter.waits
            dispatch["runs"] = waiter.runs
            dispatch["readJobs"] = self.asset_queue_jobs
            dispatch["completionRuns"] = self.asset_completion_runs
            dispatch["callbackRuns"] = self.asset_callback_runs
            waiter.close()
        return super().close_files()


def main():
    driver.bootstrap.NativeArchivedReplayUiControl = UiDispatchControl
    expected = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    try:
        driver.main()
    finally:
        # The original probe still publishes its exact failure boundary. This
        # adds ownership/dispatch evidence even when a later native service is
        # absent, without claiming a failed call or callback completed.
        output = Path(sys.argv[5])
        if output.exists():
            report = json.loads(output.read_bytes())
            if hashlib.sha256(Path(__file__).read_bytes()).hexdigest() != expected:
                raise ValueError("UI dispatcher control changed during native execution")
            report["kind"] = "original-signed-ui-caller-dispatched-replay-data-control"
            report["assetDispatch"] = dispatch
            report["scope"] = ("Original signed UI parsing/postload and caller-dispatched original asset work; "
                "OS workers, widget rendering and event-service readiness are separate")
            output.write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
