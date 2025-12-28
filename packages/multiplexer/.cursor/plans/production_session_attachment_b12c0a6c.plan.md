---
name: Production Session Attachment
overview: Full production-ready PTY-based session attachment with comprehensive error handling, testing, and polish for both Zellij and Docker backends.
todos:
  - id: deps-portable-pty
    content: Add portable-pty = "0.8" to Cargo.toml dependencies
    status: pending
  - id: deps-vt100
    content: Add vt100 = "0.15" to Cargo.toml dependencies
    status: pending
  - id: deps-proptest
    content: Add proptest = "1.0" to Cargo.toml dev-dependencies
    status: pending
  - id: deps-insta
    content: Add insta = "1.0" to Cargo.toml dev-dependencies
    status: pending
  - id: deps-verify
    content: Run cargo check to verify dependencies compile
    status: pending
  - id: dir-pty
    content: Create src/tui/pty/ directory
    status: pending
  - id: dir-terminal
    content: Create src/tui/terminal/ directory
    status: pending
  - id: dir-attach
    content: Create src/tui/attach/ directory
    status: pending
  - id: pty-mod
    content: Create src/tui/pty/mod.rs with module exports
    status: pending
  - id: pty-config-struct
    content: Define AttachConfig struct with all configurable fields
    status: pending
  - id: pty-config-defaults
    content: Implement Default for AttachConfig with sensible values
    status: pending
  - id: pty-config-keybinds
    content: Define KeyCombo type for configurable keybindings
    status: pending
  - id: pty-session-struct
    content: Define PtySession struct with child, reader, writer, size fields
    status: pending
  - id: pty-session-spawn
    content: Implement PtySession::spawn() using portable-pty CommandBuilder
    status: pending
  - id: pty-session-spawn-timeout
    content: Add timeout wrapper around PTY spawn operation
    status: pending
  - id: pty-session-read
    content: Implement PtySession::read() for async reading from PTY
    status: pending
  - id: pty-session-write
    content: Implement PtySession::write() for writing to PTY
    status: pending
  - id: pty-session-resize
    content: Implement PtySession::resize() to change PTY dimensions
    status: pending
  - id: pty-session-try-wait
    content: Implement PtySession::try_wait() to check if child exited
    status: pending
  - id: pty-session-drop
    content: Implement Drop for PtySession to kill child and close handles
    status: pending
  - id: pty-session-kill
    content: Implement PtySession::kill() for explicit termination
    status: pending
  - id: pty-buffer-struct
    content: Define Utf8Buffer struct to hold incomplete byte sequences
    status: pending
  - id: pty-buffer-push
    content: Implement Utf8Buffer::push() to add bytes
    status: pending
  - id: pty-buffer-take-complete
    content: Implement Utf8Buffer::take_complete() to extract valid UTF-8
    status: pending
  - id: pty-buffer-clear
    content: Implement Utf8Buffer::clear() for reset
    status: pending
  - id: terminal-mod
    content: Create src/tui/terminal/mod.rs with module exports
    status: pending
  - id: terminal-renderer-fn
    content: Create render_terminal() function signature
    status: pending
  - id: terminal-renderer-cells
    content: Iterate vt100 screen cells and convert to ratatui Spans
    status: pending
  - id: terminal-renderer-colors
    content: Map vt100 Color to ratatui Color (16 colors + RGB)
    status: pending
  - id: terminal-renderer-attrs
    content: Map vt100 attributes (bold, italic, underline, inverse)
    status: pending
  - id: terminal-renderer-cursor
    content: Render cursor position if visible
    status: pending
  - id: terminal-renderer-empty
    content: Handle empty/uninitialized screen gracefully
    status: pending
  - id: terminal-mouse-struct
    content: Define MouseState to track mouse mode from vt100
    status: pending
  - id: terminal-mouse-encode
    content: Implement SGR mouse encoding for click events
    status: pending
  - id: terminal-mouse-encode-move
    content: Implement SGR mouse encoding for move events
    status: pending
  - id: terminal-mouse-encode-scroll
    content: Implement SGR mouse encoding for scroll events
    status: pending
  - id: attach-mod
    content: Create src/tui/attach/mod.rs with module exports
    status: pending
  - id: attach-state-enum
    content: Define AttachState enum with Idle variant
    status: pending
  - id: attach-state-spawning
    content: Add Spawning variant with session_id, started, cancel token
    status: pending
  - id: attach-state-connected
    content: Add Connected variant with pty, parser, last_ctrl_bracket
    status: pending
  - id: attach-state-switching
    content: Add Switching variant with from/to session info
    status: pending
  - id: attach-state-detaching
    content: Add Detaching variant
    status: pending
  - id: attach-state-error
    content: Add Error variant with message, recoverable, acknowledged
    status: pending
  - id: attach-state-is-idle
    content: Implement AttachState::is_idle() helper
    status: pending
  - id: attach-state-is-connected
    content: Implement AttachState::is_connected() helper
    status: pending
  - id: attach-state-session-id
    content: Implement AttachState::current_session_id() helper
    status: pending
  - id: attach-controller-struct
    content: Define AttachController struct with state, config, sessions ref
    status: pending
  - id: attach-controller-new
    content: Implement AttachController::new()
    status: pending
  - id: attach-controller-attach
    content: Implement attach() method to start attach flow
    status: pending
  - id: attach-controller-attach-validate
    content: Validate session exists before attaching
    status: pending
  - id: attach-controller-attach-get-cmd
    content: Get attach command from API for session
    status: pending
  - id: attach-controller-attach-spawn
    content: Spawn PTY with attach command
    status: pending
  - id: attach-controller-attach-transition
    content: Transition state from Spawning to Connected
    status: pending
  - id: attach-controller-detach
    content: Implement detach() method
    status: pending
  - id: attach-controller-detach-teardown
    content: Teardown PTY in detach
    status: pending
  - id: attach-controller-detach-transition
    content: Transition state to Idle
    status: pending
  - id: attach-controller-switch-next
    content: Implement switch_next() method
    status: pending
  - id: attach-controller-switch-prev
    content: Implement switch_prev() method
    status: pending
  - id: attach-controller-switch-find
    content: Find next/prev valid session index with wraparound
    status: pending
  - id: attach-controller-switch-skip-deleted
    content: Skip deleted/invalid sessions during switch
    status: pending
  - id: attach-controller-switch-teardown
    content: Teardown old PTY before spawning new
    status: pending
  - id: attach-controller-switch-spawn
    content: Spawn new PTY for target session
    status: pending
  - id: attach-controller-input
    content: Implement handle_input() for key events
    status: pending
  - id: attach-controller-input-detach
    content: Handle Ctrl+] for detach
    status: pending
  - id: attach-controller-input-double-escape
    content: Handle Ctrl+] Ctrl+] for literal escape
    status: pending
  - id: attach-controller-input-switch-left
    content: Handle Ctrl+Left for switch prev
    status: pending
  - id: attach-controller-input-switch-right
    content: Handle Ctrl+Right for switch next
    status: pending
  - id: attach-controller-input-passthrough
    content: Forward all other input to PTY
    status: pending
  - id: attach-controller-input-mouse
    content: Handle mouse events and forward to PTY
    status: pending
  - id: attach-controller-output
    content: Implement handle_pty_output() to feed vt100 parser
    status: pending
  - id: attach-controller-resize
    content: Implement handle_resize() to resize PTY
    status: pending
  - id: attach-controller-tick
    content: Implement tick() to check timeouts and PTY status
    status: pending
  - id: attach-controller-tick-spawn-timeout
    content: Check spawn timeout in tick()
    status: pending
  - id: attach-controller-tick-pty-exit
    content: Check PTY exit status in tick()
    status: pending
  - id: attach-controller-error-ack
    content: Implement acknowledge_error() to dismiss errors
    status: pending
  - id: app-mode-attached
    content: Add Attached variant to AppMode enum
    status: pending
  - id: app-attach-controller
    content: Add AttachController field to App struct
    status: pending
  - id: app-attach-init
    content: Initialize AttachController in App::new()
    status: pending
  - id: app-get-sessions-ref
    content: Add method to get sessions reference for controller
    status: pending
  - id: mod-mainloop-select
    content: Refactor main loop to use tokio::select! for multiple sources
    status: pending
  - id: mod-mainloop-pty-read
    content: Add PTY read channel to main loop select
    status: pending
  - id: mod-mainloop-terminal-events
    content: Keep terminal event polling in select
    status: pending
  - id: mod-mainloop-tick
    content: Add periodic tick for timeout checks
    status: pending
  - id: mod-mainloop-render-throttle
    content: Add render throttling at configured FPS
    status: pending
  - id: mod-mainloop-attached-branch
    content: Add branch for handling events in attached mode
    status: pending
  - id: events-attached-mode
    content: Add handle_attached_key() function
    status: pending
  - id: events-attached-dispatch
    content: Dispatch to controller.handle_input() in attached mode
    status: pending
  - id: events-help-attached
    content: Handle ? key in attached mode to show help
    status: pending
  - id: ui-render-attached
    content: Add Attached branch to render() dispatch
    status: pending
  - id: ui-call-attached-view
    content: Call attached_view::render() when in Attached mode
    status: pending
  - id: component-attached-view-file
    content: Create src/tui/components/attached_view.rs
    status: pending
  - id: component-attached-view-render
    content: Implement render() function for attached view
    status: pending
  - id: component-attached-view-layout
    content: "Create layout: terminal area + status bar"
    status: pending
  - id: component-attached-view-terminal
    content: Call terminal renderer for main area
    status: pending
  - id: component-attached-view-status
    content: Render status bar with session name and hints
    status: pending
  - id: component-attached-view-status-session
    content: Show current session name in status bar
    status: pending
  - id: component-attached-view-status-backend
    content: Show backend type (Zellij/Docker) in status bar
    status: pending
  - id: component-attached-view-status-hints
    content: Show keybind hints in status bar
    status: pending
  - id: component-transition-file
    content: Create src/tui/components/transition.rs
    status: pending
  - id: component-transition-connecting
    content: Implement connecting overlay ("Attaching to session...")
    status: pending
  - id: component-transition-switching
    content: Implement switching overlay ("Switching to session...")
    status: pending
  - id: component-transition-error
    content: Implement error overlay with message and dismiss hint
    status: pending
  - id: component-transition-ended
    content: Implement session ended overlay
    status: pending
  - id: edge-spawn-timeout
    content: Implement 5s spawn timeout with cancellation
    status: pending
  - id: edge-teardown-timeout
    content: Implement 500ms teardown timeout with force kill
    status: pending
  - id: edge-switch-timeout
    content: Implement 2s total switch timeout
    status: pending
  - id: edge-api-timeout
    content: Add timeout to API calls during attach
    status: pending
  - id: edge-double-escape-timer
    content: Track last Ctrl+] timestamp for double-tap
    status: pending
  - id: edge-double-escape-window
    content: Use 500ms window for double-tap detection
    status: pending
  - id: edge-double-escape-send
    content: Send literal Ctrl+] (0x1D) on double-tap
    status: pending
  - id: edge-session-gone-switch
    content: Handle deleted session during switch
    status: pending
  - id: edge-session-gone-current
    content: Handle current session dying
    status: pending
  - id: edge-no-sessions
    content: Handle switch when 0 sessions exist
    status: pending
  - id: edge-one-session
    content: Handle switch when only 1 session exists
    status: pending
  - id: edge-resize-debounce
    content: Debounce resize events (100ms)
    status: pending
  - id: edge-pty-eof
    content: Handle PTY read returning 0 bytes (EOF)
    status: pending
  - id: edge-pty-error
    content: Handle PTY read/write errors
    status: pending
  - id: edge-large-output
    content: Handle rapid output without memory exhaustion
    status: pending
  - id: edge-scrollback-limit
    content: Enforce scrollback line limit in vt100 parser
    status: pending
  - id: refresh-on-return
    content: Auto-refresh session list when returning to SessionList
    status: pending
  - id: test-unit-buffer-partial
    content: Test Utf8Buffer with partial UTF-8 sequences
    status: pending
  - id: test-unit-buffer-complete
    content: Test Utf8Buffer with complete UTF-8
    status: pending
  - id: test-unit-buffer-empty
    content: Test Utf8Buffer with empty input
    status: pending
  - id: test-unit-buffer-multi
    content: Test Utf8Buffer across multiple pushes
    status: pending
  - id: test-unit-renderer-basic
    content: Test renderer with simple text
    status: pending
  - id: test-unit-renderer-colors
    content: Test renderer color mapping
    status: pending
  - id: test-unit-renderer-attrs
    content: Test renderer attribute mapping
    status: pending
  - id: test-unit-renderer-snapshot
    content: Add insta snapshot tests for renderer output
    status: pending
  - id: test-unit-state-transitions
    content: Test all valid state transitions
    status: pending
  - id: test-unit-state-invalid
    content: Test invalid state transitions are rejected
    status: pending
  - id: test-unit-input-routing
    content: Test input routing logic
    status: pending
  - id: test-unit-double-escape
    content: Test double Ctrl+] escape detection
    status: pending
  - id: test-unit-switch-wraparound
    content: Test session switch wraparound logic
    status: pending
  - id: test-integration-pty-spawn
    content: Test PtySession::spawn() with real process
    status: pending
  - id: test-integration-pty-echo
    content: Test PTY read/write roundtrip with cat
    status: pending
  - id: test-integration-pty-resize
    content: Test PTY resize with tput
    status: pending
  - id: test-integration-pty-exit
    content: Test PTY exit detection
    status: pending
  - id: test-integration-pty-kill
    content: Test PTY kill and cleanup
    status: pending
  - id: test-stress-rapid-output
    content: Stress test with yes | head -10000
    status: pending
  - id: test-stress-rapid-input
    content: Stress test with rapid key input
    status: pending
  - id: test-stress-rapid-switch
    content: Stress test with rapid session switching
    status: pending
  - id: test-property-vt100
    content: "Property test: vt100 parser never panics on random input"
    status: pending
  - id: test-property-buffer
    content: "Property test: Utf8Buffer always produces valid UTF-8"
    status: pending
  - id: help-overlay-file
    content: Add attached mode help to help overlay
    status: pending
  - id: help-overlay-keybinds
    content: List all keybinds in help overlay
    status: pending
  - id: logging-attach-start
    content: Add tracing::info for attach start
    status: pending
  - id: logging-attach-success
    content: Add tracing::info for successful attach
    status: pending
  - id: logging-attach-fail
    content: Add tracing::error for attach failure
    status: pending
  - id: logging-detach
    content: Add tracing::info for detach
    status: pending
  - id: logging-switch
    content: Add tracing::info for session switch
    status: pending
  - id: logging-pty-spawn
    content: Add tracing::debug for PTY spawn
    status: pending
  - id: logging-pty-exit
    content: Add tracing::debug for PTY exit
    status: pending
  - id: logging-timeout
    content: Add tracing::warn for timeout events
    status: pending
  - id: components-mod-update
    content: Update components/mod.rs to export new components
    status: pending
  - id: tui-mod-update
    content: Update tui/mod.rs to include new submodules
    status: pending
  - id: final-cargo-check
    content: Run cargo check to verify no compile errors
    status: pending
  - id: final-cargo-clippy
    content: Run cargo clippy and fix all warnings
    status: pending
  - id: final-cargo-test
    content: Run cargo test and verify all tests pass
    status: pending
  - id: final-manual-test-zellij
    content: "Manual test: attach/detach/switch with Zellij backend"
    status: pending
  - id: final-manual-test-docker
    content: "Manual test: attach/detach/switch with Docker backend"
    status: pending
---

# Production-Ready Session Attachment

## Architecture

```mermaid
stateDiagram-v2
    direction LR
    
    state AttachState {
        Idle --> Spawning: attach()
        Spawning --> Connected: PTY ready
        Spawning --> Error: timeout/fail
        Connected --> Switching: Ctrl+arrow
        Connected --> Detaching: Ctrl+]
        Connected --> Error: PTY died
        Switching --> Connected: new PTY ready
        Switching --> Error: switch failed
        Detaching --> Idle: cleanup done
        Error --> Idle: acknowledged
    }
```



## File Structure

```javascript
src/tui/
├── mod.rs                    # Main loop (modify)
├── app.rs                    # App state (modify)
├── events.rs                 # Event handling (modify)
├── ui.rs                     # Rendering dispatch (modify)
├── pty/
│   ├── mod.rs               # PTY module exports
│   ├── session.rs           # PtySession: spawn, read, write, resize
│   ├── buffer.rs            # UTF-8 buffering for partial reads
│   └── config.rs            # Configurable timeouts, limits
├── terminal/
│   ├── mod.rs               # Terminal emulation exports
│   ├── renderer.rs          # vt100 -> ratatui conversion
│   └── mouse.rs             # Mouse event encoding/decoding
├── attach/
│   ├── mod.rs               # Attach state machine
│   ├── state.rs             # AttachState enum and transitions
│   └── controller.rs        # Orchestrates attach/detach/switch
└── components/
    ├── attached_view.rs     # Renders terminal + status bar
    └── transition.rs        # Loading/switching overlays
```



## Success Criteria

- [ ] Attach to Zellij session, see Claude Code, interact normally
- [ ] Attach to Docker container, see shell, interact normally
- [ ] Detach with Ctrl+], return to session list
- [ ] Switch sessions with Ctrl+Left/Right
- [ ] Session dies -> graceful return to list