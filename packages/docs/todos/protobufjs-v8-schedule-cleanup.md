---
id: protobufjs-v8-schedule-cleanup
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/todos/protobufjs-v8-watch.md
source_marker: false
---

# Remove the protobufjs v8 watch schedule after upstream cleanup

The live Temporal schedule is useful until `@temporalio/proto` supports
protobufjs v8 and the repository cleanup has shipped. Removing it is a
privileged cluster mutation, not user acceptance.

## Remaining

- [ ] Wait until `protobufjs-v8-watch` records that the v8 cleanup has shipped.
- [ ] Obtain explicit authorization to delete the live `protobufjs-v8-watch-weekly` schedule.
- [ ] Confirm the schedule is absent and archive this record.
