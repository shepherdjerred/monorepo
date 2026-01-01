---
name: Session Attachment (Revised)
overview: PTY-based session attachment using pty-process (async-native), with incremental delivery milestones and simplified state machine.
todos:
  - id: m0-deps-pty-process
    content: Add pty-process = { version = "0.4", features = ["async"] } to Cargo.toml
    status: pending
  - id: m0-deps-vt100
    content: Add vt100 = "0.15" to Cargo.toml
    status: pending
  - id: m0-deps-verify
    content: Run cargo check to verify pty-process async API compiles
    status: pending
  - id: m0-dir-attached
    content: Create src/tui/attached/ directory
    status: pending
  - id: m0-attached-mod
    content: Create src/tui/attached/mod.rs with module exports
    status: pending
  - id: mvp-pty-handle-struct
    content: Create pty_handle.rs with PtyHandle struct wrapping Pty + Child
    status: pending
  - id: mvp-pty-handle-spawn
    content: Implement PtyHandle::spawn(cmd, size) -> Result<Self>
    status: pending
  - id: mvp-pty-handle-read
    content: Implement async read() delegating to pty.read()
    status: pending
  - id: mvp-pty-handle-write
    content: Implement write() delegating to pty.write_all()
    status: pending
  - id: mvp-pty-handle-resize
    content: Implement resize() using pty.resize()
    status: pending
  - id: mvp-pty-handle-try-wait
    content: Implement try_wait() to check child exit status
    status: pending
  - id: mvp-pty-handle-drop
    content: Implement Drop to kill child process
    status: pending
  - id: mvp-terminal-buffer-struct
    content: Create terminal_buffer.rs with TerminalBuffer struct
    status: pending
  - id: mvp-terminal-buffer-parser
    content: Hold vt100::Parser in TerminalBuffer
    status: pending
  - id: mvp-terminal-buffer-utf8
    content: "Add utf8_buffer: Vec<u8> for incomplete sequences"
    status: pending
  - id: mvp-terminal-buffer-process
    content: "Implement process(data: &[u8]) that buffers and feeds parser"
    status: pending
  - id: mvp-terminal-buffer-screen
    content: Implement screen() -> &vt100::Screen accessor
    status: pending
  - id: mvp-renderer-fn
    content: Create renderer.rs with render_screen(screen, frame, area)
    status: pending
  - id: mvp-renderer-iterate-cells
    content: Iterate screen.contents() rows and cells
    status: pending
  - id: mvp-renderer-cell-to-span
    content: Convert each cell to ratatui Span with char and style
    status: pending
  - id: mvp-renderer-colors
    content: Map vt100::Color to ratatui::Color
    status: pending
  - id: mvp-renderer-attrs
    content: Map bold/italic/underline/inverse attributes
    status: pending
  - id: mvp-renderer-lines
    content: Build Vec<Line> from rows
    status: pending
  - id: mvp-renderer-paragraph
    content: Create Paragraph widget from lines
    status: pending
  - id: mvp-app-mode-attached
    content: Add Attached variant to AppMode enum
    status: pending
  - id: mvp-app-attached-state
    content: "Add attached_state: Option<AttachedState> to App"
    status: pending
  - id: mvp-attached-state-struct
    content: Define AttachedState with session_id, pty, parser, etc.
    status: pending
  - id: mvp-app-attach-method
    content: Implement App::attach(session_id) method
    status: pending
  - id: mvp-app-attach-get-cmd
    content: Get attach command from API client
    status: pending
  - id: mvp-app-attach-spawn
    content: Spawn PtyHandle with command
    status: pending
  - id: mvp-app-attach-set-mode
    content: Set mode to Attached and populate attached_state
    status: pending
  - id: mvp-app-detach-method
    content: Implement App::detach() method
    status: pending
  - id: mvp-app-detach-drop-pty
    content: Drop PtyHandle (triggers kill)
    status: pending
  - id: mvp-app-detach-set-mode
    content: Set mode back to SessionList
    status: pending
  - id: mvp-app-detach-refresh
    content: Refresh session list after detach
    status: pending
  - id: mvp-app-handle-pty-exit
    content: Implement handle_pty_exit() for EOF/error
    status: pending
  - id: mvp-events-attached-branch
    content: Add AppMode::Attached branch in handle_key_event
    status: pending
  - id: mvp-events-ctrl-bracket
    content: Detect Ctrl+] (KeyCode::Char(']') + CONTROL)
    status: pending
  - id: mvp-events-detach-action
    content: Call app.detach() on Ctrl+]
    status: pending
  - id: mvp-events-passthrough
    content: Forward all other keys to PTY
    status: pending
  - id: mvp-events-encode-key
    content: Encode KeyEvent to terminal escape sequence bytes
    status: pending
  - id: mvp-mainloop-select
    content: Refactor main loop to use tokio::select!
    status: pending
  - id: mvp-mainloop-pty-branch
    content: Add PTY read branch that calls read_pty_if_attached
    status: pending
  - id: mvp-mainloop-render-throttle
    content: Add 30fps render throttling
    status: pending
  - id: mvp-mainloop-enter-attach
    content: On Enter in SessionList, call app.attach()
    status: pending
  - id: mvp-ui-attached-branch
    content: Add Attached branch to ui::render()
    status: pending
  - id: mvp-ui-call-renderer
    content: Call attached renderer for terminal area
    status: pending
  - id: mvp-test-manual-attach
    content: "Manual test: attach to zellij session, see output"
    status: pending
  - id: mvp-test-manual-type
    content: "Manual test: type in attached session"
    status: pending
  - id: mvp-test-manual-detach
    content: "Manual test: Ctrl+] detaches cleanly"
    status: pending
  - id: v11-switch-method
    content: Implement App::switch_to_session(session_id)
    status: pending
  - id: v11-switch-teardown
    content: Teardown current PTY in switch
    status: pending
  - id: v11-switch-spawn
    content: Spawn new PTY for target session
    status: pending
  - id: v11-switch-find-next
    content: Implement find_next_session_id() with wraparound
    status: pending
  - id: v11-switch-find-prev
    content: Implement find_prev_session_id() with wraparound
    status: pending
  - id: v11-switch-by-uuid
    content: Use UUID to find session, not index
    status: pending
  - id: v11-switch-skip-invalid
    content: Skip sessions that no longer exist
    status: pending
  - id: v11-switch-no-sessions
    content: "Handle case: 0 sessions (do nothing)"
    status: pending
  - id: v11-switch-one-session
    content: "Handle case: 1 session (do nothing)"
    status: pending
  - id: v11-events-ctrl-left
    content: Detect Ctrl+Left and call switch_prev
    status: pending
  - id: v11-events-ctrl-right
    content: Detect Ctrl+Right and call switch_next
    status: pending
  - id: v11-test-manual-switch
    content: "Manual test: switch between 2+ sessions"
    status: pending
  - id: v12-spawn-timeout
    content: Add 5s timeout around PTY spawn using tokio::time::timeout
    status: pending
  - id: v12-spawn-timeout-error
    content: Show error message on spawn timeout
    status: pending
  - id: v12-teardown-timeout
    content: Add 500ms timeout for PTY teardown
    status: pending
  - id: v12-teardown-force-kill
    content: Force kill child if teardown times out
    status: pending
  - id: v12-double-escape-track
    content: "Track last_ctrl_bracket: Option<Instant> in AttachedState"
    status: pending
  - id: v12-double-escape-check
    content: Check if second Ctrl+] within 300ms
    status: pending
  - id: v12-double-escape-send
    content: Send literal 0x1D to PTY on double-tap
    status: pending
  - id: v12-double-escape-reset
    content: Reset timer after sending literal or detaching
    status: pending
  - id: v12-resize-handler
    content: Handle terminal resize events in attached mode
    status: pending
  - id: v12-resize-debounce
    content: Debounce resize events (100ms)
    status: pending
  - id: v12-resize-forward
    content: Call pty.resize() with new dimensions
    status: pending
  - id: v12-utf8-buffer-impl
    content: Implement proper UTF-8 buffering in terminal_buffer
    status: pending
  - id: v12-utf8-partial-detect
    content: Detect incomplete UTF-8 sequences at buffer end
    status: pending
  - id: v12-utf8-carry-over
    content: Carry incomplete bytes to next read
    status: pending
  - id: v12-error-recovery
    content: Show error message on PTY errors, allow return to list
    status: pending
  - id: v12-test-timeout
    content: Test spawn timeout with slow command
    status: pending
  - id: v12-test-double-escape
    content: Test double Ctrl+] sends literal
    status: pending
  - id: v13-status-bar-attached
    content: Create attached mode status bar
    status: pending
  - id: v13-status-bar-session-name
    content: Show session name in status bar
    status: pending
  - id: v13-status-bar-backend
    content: Show backend type (Zellij/Docker)
    status: pending
  - id: v13-status-bar-hints
    content: Show Ctrl+] and Ctrl+arrows hints
    status: pending
  - id: v13-help-attached
    content: Add attached mode section to help overlay
    status: pending
  - id: v13-help-keybinds
    content: Document all attached mode keybinds
    status: pending
  - id: v13-transition-connecting
    content: Show brief "Connecting..." during attach
    status: pending
  - id: v13-transition-switching
    content: Show brief "Switching..." during switch
    status: pending
  - id: v13-transition-ended
    content: Show "Session ended" on PTY exit
    status: pending
  - id: v13-error-actionable
    content: Make error messages suggest next steps
    status: pending
  - id: v14-test-unit-utf8
    content: Unit test UTF-8 buffering with partial sequences
    status: pending
  - id: v14-test-unit-renderer
    content: Unit test renderer color/attr mapping
    status: pending
  - id: v14-test-unit-renderer-snapshot
    content: Snapshot tests for renderer output
    status: pending
  - id: v14-test-unit-key-encode
    content: Unit test key-to-escape-sequence encoding
    status: pending
  - id: v14-test-integration-pty-spawn
    content: Integration test PTY spawn with echo command
    status: pending
  - id: v14-test-integration-pty-io
    content: Integration test PTY read/write roundtrip
    status: pending
  - id: v14-test-integration-pty-resize
    content: Integration test PTY resize
    status: pending
  - id: v14-test-integration-pty-exit
    content: Integration test PTY exit detection
    status: pending
  - id: v14-test-property-vt100
    content: "Property test: vt100 never panics on random input"
    status: pending
  - id: v14-test-stress-output
    content: Stress test with rapid PTY output
    status: pending
  - id: v14-test-e2e-zellij
    content: "E2E test: full flow with Zellij backend"
    status: pending
  - id: v14-test-e2e-docker
    content: "E2E test: full flow with Docker backend"
    status: pending
  - id: v14-logging-attach
    content: Add tracing for attach/detach/switch events
    status: pending
  - id: v14-logging-pty
    content: Add debug logging for PTY operations
    status: pending
  - id: v14-final-clippy
    content: Run cargo clippy, fix all warnings
    status: pending
  - id: v14-final-test
    content: Run cargo test, verify all pass
    status: pending
---

# Session Attachment - Revised Plan

## Key Changes from Previous Plan

1. **Use `pty-process` instead of `portable-pty`** - Native async support via `AsyncPtyMaster`
2. **Use session IDs (UUID) not indices** - Indices shift when sessions are deleted
3. **Incremental delivery** - MVP in 2-3 days, then polish
4. **Simplified state machine** - Skip explicit Spawning/Switching/Detaching states for v1
5. **30 FPS rendering** - Terminal content doesn't need 60 FPS
6. **300ms double-tap window** - Standard timing (vim uses this)

## Dependencies

```toml
[dependencies]
pty-process = { version = "0.4", features = ["async"] }  # Async-native PTY
vt100 = "0.15"                                            # Terminal parser
tokio-util = { version = "0.7", features = ["codec"] }   # Already in deps, need for IO

[dev-dependencies]  
proptest = "1.4"
insta = "1.0"
```



## Architecture

```mermaid
flowchart LR
    subgraph MainLoop["Main Loop (tokio::select!)"]
        TermEvents[Terminal Events]
        PtyOutput[PTY Output Channel]
        Tick[30fps Tick]
    end
    
    PtyThread[PTY Reader Task] -->|mpsc channel| PtyOutput
    TermEvents --> InputRouter
    PtyOutput --> Vt100Parser
    Vt100Parser --> ScreenBuffer
    Tick --> Render
    ScreenBuffer --> Render
```



### PTY I/O Pattern

`pty-process` with async feature provides `Pty` which implements `AsyncRead + AsyncWrite`. This works directly with tokio:

```rust
use pty_process::Pty;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

let mut pty = Pty::new()?;
pty.resize(pty_process::Size::new(rows, cols))?;
let mut cmd = pty_process::Command::new("zellij");
cmd.args(["attach", session_name]);
let mut child = cmd.spawn(&pty.pts()?)?;

// Now pty implements AsyncRead + AsyncWrite
let mut buf = [0u8; 4096];
let n = pty.read(&mut buf).await?;  // Async!
pty.write_all(b"input").await?;     // Async!
```



## Incremental Milestones

### MVP (Days 1-2): Basic Attach/Detach

**Goal:** Press Enter to attach, see terminal output, Ctrl+] to detach

- Spawn PTY with attach command
- Forward PTY output to vt100 parser
- Render vt100 screen buffer to ratatui
- Forward keyboard input to PTY
- Ctrl+] detaches back to session list
- Handle PTY exit (EOF)

**No:** Session switching, fancy transitions, error recovery, mouse support

### v1.1 (Day 3): Session Switching

**Goal:** Ctrl+Left/Right switches sessions

- Track current session by UUID (not index)
- Teardown current PTY, spawn new one
- Handle edge cases: session deleted, 0/1 sessions

### v1.2 (Days 4-5): Robustness

**Goal:** Handle all edge cases gracefully

- Spawn timeout (5s)
- Teardown timeout (500ms) with force kill
- Double Ctrl+] escape hatch (300ms window)
- Resize handling with debounce
- UTF-8 buffering for partial sequences

### v1.3 (Days 6-7): Polish

**Goal:** Production UX

- Status bar with session name and hints
- Error messages with actionable text
- Help overlay for attached mode
- Transition feedback (brief "Connecting..." overlay)

### v1.4 (Days 8-10): Testing

**Goal:** Comprehensive test coverage

- Unit tests for all components
- Integration tests with real PTY
- Property tests for parser resilience
- Manual E2E with Zellij and Docker

## File Structure (Simplified)

```javascript
src/tui/
├── mod.rs                    # Main loop with tokio::select!
├── app.rs                    # Add Attached mode, attached state
├── events.rs                 # Add attached mode input handling
├── ui.rs                     # Add attached mode rendering
├── attached/
│   ├── mod.rs               # Module exports
│   ├── pty_handle.rs        # Async PTY wrapper
│   ├── terminal_buffer.rs   # vt100 + UTF-8 buffering
│   └── renderer.rs          # vt100 screen -> ratatui
└── components/
    └── attached_view.rs     # Terminal + status bar rendering
```



## Simplified State (v1)

```rust
// In app.rs
pub enum AppMode {
    SessionList,
    CreateDialog,
    ConfirmDelete,
    Help,
    Attached,  // NEW
}

// Attached state - separate struct, not in enum
pub struct AttachedState {
    pub session_id: Uuid,           // Track by ID, not index
    pub session_name: String,       // For display
    pub pty: Pty,                   // pty_process::Pty (AsyncRead + AsyncWrite)
    pub child: Child,               // pty_process::Child
    pub parser: vt100::Parser,
    pub utf8_buffer: Vec<u8>,       // Incomplete UTF-8 sequences
    pub last_ctrl_bracket: Option<Instant>,  // For double-tap
}
```



## Raw Mode Considerations

The TUI is already in raw mode via crossterm. When attached:

1. **Keyboard:** All keys go to PTY (except Ctrl+], Ctrl+arrows) - works fine
2. **Mouse:** Currently enabled in TUI. When attached:

- Check if vt100 parser indicates mouse mode enabled by attached app
- If yes: encode mouse events and forward to PTY
- If no: ignore mouse events (or forward anyway, app ignores them)

3. **Bracketed paste:** The outer TUI may have this enabled. The inner app (zellij) also uses it.

- Solution: Don't enable bracketed paste in the TUI, let the PTY app handle it
- Or: Track state and proxy correctly (complex)

For MVP: Disable mouse forwarding, re-enable in v1.2.

## Main Loop Sketch

```rust
async fn run_main_loop(terminal: &mut Terminal<...>, app: &mut App) -> Result<()> {
    let mut last_render = Instant::now();
    let render_interval = Duration::from_millis(33); // ~30 FPS
    
    loop {
        // Render if enough time passed
        if last_render.elapsed() >= render_interval {
            terminal.draw(|f| ui::render(f, app))?;
            last_render = Instant::now();
        }

        let timeout = render_interval.saturating_sub(last_render.elapsed());
        
        tokio::select! {
            // Terminal events (keyboard, mouse, resize)
            event = poll_terminal_event(timeout) => {
                if let Some(event) = event? {
                    handle_event(app, event).await?;
                }
            }
            
            // PTY output (only when attached)
            result = read_pty_if_attached(app) => {
                if let Some(data) = result? {
                    handle_pty_output(app, &data);
                }
            }
        }

        if app.should_quit {
            break;
        }
    }
    Ok(())
}

async fn read_pty_if_attached(app: &mut App) -> Result<Option<Vec<u8>>> {
    if let Some(attached) = &mut app.attached_state {
        let mut buf = [0u8; 4096];
        match attached.pty.read(&mut buf).await {
            Ok(0) => {
                // EOF - PTY closed
                app.handle_pty_exit();
                Ok(None)
            }
            Ok(n) => Ok(Some(buf[..n].to_vec())),
            Err(e) => {
                app.handle_pty_error(e);
                Ok(None)
            }
        }
    } else {
        // Not attached, return pending future that never resolves
        std::future::pending().await
    }
}
```



## Success Criteria

- [ ] MVP: Attach with Enter, see output, type, Ctrl+] detach
- [ ] v1.1: Ctrl+Left/Right switches sessions
- [ ] v1.2: All edge cases handled, no panics