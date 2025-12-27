# Critique of Session Attachment Plan

## 👍 Strengths

1. **UUID-based session tracking** - Smart to avoid index shifting issues on delete
2. **Incremental milestones** - MVP first, polish later is the right approach
3. **Good dependency choices** - `pty-process` + `vt100` is solid
4. **Double-tap escape hatch** - 300ms is standard (matches vim)
5. **30 FPS render throttle** - Appropriate for terminal content
6. **Good test plan** - Unit, integration, property, and E2E coverage

---

## ⚠️ Issues to Address

### 1. crossterm's `poll_event` is blocking, not async

Current `events.rs` uses `event::poll(timeout)` which **blocks the thread**. This breaks `tokio::select!`. Need:

```rust
use crossterm::event::EventStream;
use futures::StreamExt;

let mut event_stream = EventStream::new();
// In select!:
event = event_stream.next() => { ... }
```

The plan doesn't mention this migration.

### 2. Borrow conflict in `tokio::select!`

The main loop sketch has:
```rust
tokio::select! {
    event = poll_terminal_event(timeout) => { handle_event(app, event) }
    result = read_pty_if_attached(app) => { handle_pty_output(app, &data) }
}
```

Both branches need `&mut app` simultaneously. Need to restructure—either split the PTY out of `App`, use `Option::take()` patterns, or use channels.

### 3. `AttachedState` storing `Pty` directly creates ownership issues

```rust
pub struct AttachedState {
    pub pty: Pty,  // Needs &mut for read AND write
    pub child: Child,
}
```

Consider either:
- Splitting into `OwnedReadHalf`/`OwnedWriteHalf` via `tokio::io::split()`
- Using channels for PTY I/O
- Moving PTY to a separate task that communicates via mpsc

### 4. Missing: session list access during attached mode

For Ctrl+Left/Right switching, you need the session list. The plan doesn't address:
- Where the cached list lives
- How/when to refresh it (sessions can be deleted externally)
- What happens if current session is deleted while attached

### 5. Cursor rendering not addressed

`vt100::Parser` tracks cursor position, but the plan's renderer doesn't mention setting `Frame::set_cursor_position()`. Without this, the attached terminal won't show a cursor.

### 6. Missing: the async model differs from current approach

Current `mod.rs` does a **suspend/exec** pattern. The plan switches to an **embedded PTY** model. This is a bigger architectural shift than the plan acknowledges—worth calling out explicitly.

---

## 🔧 Suggestions

### Simplify the main loop architecture

Instead of fighting borrow issues, consider:

```rust
// Spawn a dedicated PTY reader task
let (pty_tx, mut pty_rx) = mpsc::channel(32);

// In select!:
tokio::select! {
    event = event_stream.next() => { ... }
    Some(data) = pty_rx.recv() => { ... }
    _ = tick_interval.tick() => { render() }
}
```

This avoids the `&mut app` in two branches problem.

### Consider `pty-process` latest version

Double-check crates.io for the latest version and API shape. The async patterns changed between versions.

### Add missing TODOs

```yaml
- id: m0-eventstream
  content: Migrate from blocking poll_event to crossterm EventStream
  status: pending

- id: mvp-renderer-cursor
  content: Set frame cursor position from vt100::Parser cursor state
  status: pending
```

---

## Minor Nits

- **`tokio-util` codec** - Probably not needed; `pty-process` async works directly with `AsyncRead/AsyncWrite`
- **TODO granularity** - Items like `mvp-pty-handle-read`, `mvp-pty-handle-write`, `mvp-pty-handle-resize` could be one item (they're 3-5 lines each)
- **Bracketed paste** - The TUI doesn't currently enable it, so this is fine, but worth verifying

---

## Bottom Line

The plan is ~85% solid. The main gap is the **async event handling architecture**—the current blocking `poll_event` + the `tokio::select!` borrow conflicts will bite you early in MVP. Recommend sorting out the EventStream migration and PTY ownership model before starting implementation.
