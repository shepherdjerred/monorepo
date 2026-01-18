# Progressive Disclosure Testing Guide

This guide provides step-by-step instructions for testing the progressive disclosure and First Run Experience implementation across all platforms.

## Prerequisites

1. Build the Rust backend:
   ```bash
   cd /workspace/packages/clauderon
   cargo build --release
   ```

2. Build the web frontend:
   ```bash
   cd /workspace/packages/clauderon/web/frontend
   bun install
   bun run build
   ```

3. Start the daemon:
   ```bash
   cd /workspace/packages/clauderon
   cargo run -- daemon
   ```

## Backend Tests

### Unit Tests

Run the user preferences tests:
```bash
cd /workspace/packages/clauderon
cargo test user_preferences
cargo test preferences
```

Expected results:
- ✅ Experience level calculation tests pass
- ✅ Operation tracking tests pass
- ✅ Hint dismissal tests pass
- ✅ TUI preferences load/save tests pass

## TUI Testing

### Test 1: First Run Experience

1. Delete existing preferences:
   ```bash
   rm ~/.config/clauderon/preferences.json
   ```

2. Launch TUI:
   ```bash
   cargo run -- tui
   ```

3. **Expected Results:**
   - ✅ FRE modal appears immediately with "Welcome to Clauderon" screen
   - ✅ Press `Enter` → Navigate to "Key Features" screen
   - ✅ Press `→` → Navigate to "Quick Start Guide" screen
   - ✅ Press `s` → FRE closes and session list appears
   - ✅ Restart TUI → FRE does NOT appear again

4. **Alternative Navigation:**
   - Delete preferences again
   - Launch TUI
   - Press `←` on Features screen → Goes back to Welcome
   - Press `n` on Quick Start → Opens create session dialog
   - Press `q` on Quick Start → Closes FRE

### Test 2: FirstTime Experience Level

1. With fresh preferences (no sessions created):
   ```bash
   cargo run -- tui
   ```

2. Skip FRE and view help:
   - Press `s` to skip FRE
   - Press `?` to open help

3. **Expected Results:**
   - ✅ Help modal shows "Quick Start" title
   - ✅ Only 7 shortcuts visible:
     - ↑/↓ Navigate
     - Enter Attach to session
     - n New session
     - d Delete session
     - a Archive session
     - ? Help
     - q Quit
   - ✅ Footer shows "Press 'h' for full reference"

4. Check status bar:
   - Close help with `?`
   - **Expected**: Status bar shows "Press 'n' to create your first session"

### Test 3: Regular Experience Level

1. Create 3 sessions using TUI:
   - Press `n` to create first session
   - Fill in details and submit
   - Repeat 2 more times

2. Press `?` to open help:
   - **Expected**: Help shows ~15 shortcuts (includes filter shortcuts, basic operations)
   - **Expected**: No advanced modes shown (Copy Mode, Locked Mode, etc.)

3. Check status bar:
   - **Expected**: Shows "Filter: All (3/3) | [n]ew [d]elete [a]rchive [?]help [q]uit"

### Test 4: Advanced Experience Level

1. Continue from Regular level (3 sessions exist)

2. Trigger advanced operations 3 times:
   - Attach to a Docker session (if available)
   - Press `f` to refresh (advanced operation)
   - Repeat 2 more times

3. Press `?` to open help:
   - **Expected**: Help shows "Help (All Shortcuts)" title
   - **Expected**: Full 30+ shortcuts visible including:
     - All session list operations
     - While Attached section
     - Copy Mode section
     - Scroll Mode section
     - Locked Mode section

4. Check status bar:
   - **Expected**: Shows full filter info "Filter: All (3/3 sessions) | Press 1-5 to change filter"

## Web UI Testing

### Test 1: FirstTime Experience Level

1. Open browser in incognito mode:
   ```bash
   open http://localhost:3030
   ```

2. Log in (first time user with no sessions)

3. **Expected Results:**
   - ✅ FRE modal appears immediately with full-screen overlay
   - ✅ "CLAUDERON" logo and "Development environments, on demand" tagline visible
   - ✅ "Skip" button in top-right
   - ✅ "Get Started →" button at bottom
   - ✅ Step indicator shows "●○○○" (step 1 of 4)

4. Navigate through FRE:
   - Click "Get Started" → Features screen
   - See "Sessions" feature card
   - Click arrows to cycle through 4 features: Sessions, Agents, Backends, Real-time
   - Click "Continue" → Quick Start screen
   - See checklist with 3 items
   - Click "Create Your First Session" → FRE closes, create dialog opens

5. Refresh page:
   - **Expected**: FRE does NOT appear again

### Test 2: FirstTime Session Card UI

1. Close create dialog without creating
2. Create a session manually
3. **Expected Results:**
   - ✅ Session card shows only 4 buttons:
     - Terminal (Attach) - Primary button
     - Edit - Icon button
     - Archive - Icon button
     - Delete - Icon button
   - ✅ No Refresh button visible (even for Docker)
   - ✅ No dropdown menu (⋮) visible
   - ✅ Hint banner appears: "Welcome! Click the Terminal icon to attach to your session and start coding."

4. Dismiss hint:
   - Click X on hint banner
   - Refresh page
   - **Expected**: Hint does NOT reappear

### Test 3: Regular Experience Level

1. Create 2 more sessions (total: 3 sessions)

2. **Expected Results:**
   - ✅ Promotion hint appears: "You've been promoted! More options are now available in the ⋮ menu on each session."
   - ✅ Session cards now show dropdown menu (⋮) icon
   - ✅ Click dropdown → "Refresh Container" option visible (for Docker sessions)
   - ✅ Refresh button still NOT a direct icon button

### Test 4: Advanced Experience Level

1. Click "Refresh Container" from dropdown 3 times (on Docker session)

2. **Expected Results:**
   - ✅ Session cards now show direct Refresh icon button (for Docker sessions)
   - ✅ Dropdown menu still present with fewer items
   - ✅ Dropdown contains advanced operations:
     - Regenerate Metadata
     - Update Access Mode

### Test 5: FRE Skip and Tutorial

1. Open new incognito window
2. Log in as new user
3. FRE appears
4. Click "Skip" in top-right:
   - **Expected**: FRE closes immediately
   - **Expected**: Dashboard shows with no sessions
   - **Expected**: FRE marked complete (won't show on refresh)

5. Repeat with new user, navigate to Tutorial step:
   - Click through Welcome, Features, Quick Start
   - Click "Or view the interactive tutorial →"
   - **Expected**: Tutorial screen appears with 4-step walkthrough description
   - Click "Start Tutorial" → FRE completes
   - Click "Skip to Dashboard" → FRE completes without tutorial

## API Testing

### Test Preferences Endpoints

1. Get user preferences:
   ```bash
   curl http://localhost:3030/api/preferences \
     -H "Cookie: session_token=YOUR_TOKEN"
   ```

   **Expected Response:**
   ```json
   {
     "user_id": "user-id",
     "experience_level": "FirstTime",
     "sessions_created_count": 0,
     "sessions_attached_count": 0,
     "advanced_operations_used_count": 0,
     "first_session_at": null,
     "last_activity_at": "2026-01-18T...",
     "dismissed_hints": [],
     "ui_preferences": {},
     "created_at": "2026-01-18T...",
     "updated_at": "2026-01-18T..."
   }
   ```

2. Track operation:
   ```bash
   curl -X POST http://localhost:3030/api/preferences/track \
     -H "Content-Type: application/json" \
     -H "Cookie: session_token=YOUR_TOKEN" \
     -d '{"operation": "session_created"}'
   ```

   **Expected**: 200 OK, preferences updated

3. Dismiss hint:
   ```bash
   curl -X POST http://localhost:3030/api/preferences/dismiss-hint \
     -H "Content-Type: application/json" \
     -H "Cookie: session_token=YOUR_TOKEN" \
     -d '{"hint_id": "first-session-created"}'
   ```

   **Expected**: 200 OK, hint added to dismissed_hints array

4. Complete first run:
   ```bash
   curl -X POST http://localhost:3030/api/preferences/complete-first-run \
     -H "Cookie: session_token=YOUR_TOKEN"
   ```

   **Expected**: 200 OK, "first-run-complete" added to dismissed_hints

## Regression Testing

### Test Existing Functionality

1. **Session List**: All existing filters work (All, Running, Idle, Completed, Archived)
2. **Create Dialog**: All fields work, session creation succeeds
3. **Attach**: Console attachment works, terminal output visible
4. **Edit**: Editing session metadata works
5. **Delete**: Deletion with confirmation works
6. **Archive/Unarchive**: Sessions can be archived and restored

### Test Real-time Updates

1. Open two browser windows with same user
2. In Window 1: Create a session
3. **Expected**: Window 2 receives WebSocket event and shows new session
4. In Window 1: Perform 3 advanced operations
5. **Expected**: Both windows update to show Advanced level UI (direct Refresh button)

## Edge Cases

### Test 1: Rapid Operations

1. Create 3 sessions rapidly (within 5 seconds)
2. **Expected**: Experience level updates correctly to Regular

### Test 2: Time-Based Promotion

1. Create preferences with old `first_session_at` date (>30 days ago):
   ```bash
   # Manually edit ~/.config/clauderon/preferences.json
   # Set first_session_at to "2025-12-01T00:00:00Z"
   ```

2. Launch TUI
3. **Expected**: Help shows Advanced level (full shortcuts)

### Test 3: Preferences Corruption

1. Corrupt preferences file:
   ```bash
   echo "invalid json" > ~/.config/clauderon/preferences.json
   ```

2. Launch TUI
3. **Expected**: New preferences created, no crash

4. Check status bar:
   **Expected**: Shows FirstTime status

### Test 4: Network Issues

1. Stop daemon
2. Open web UI
3. **Expected**:
   - Preferences default to FirstTime
   - No crashes
   - Connection error displayed

## Success Criteria

All tests should pass with these results:

### Progressive Disclosure ✅
- [x] FirstTime users see 4 buttons only (Web) / 7 shortcuts (TUI)
- [x] Regular users see dropdown menu (Web) / 15 shortcuts (TUI)
- [x] Advanced users see all operations (Web) / 30+ shortcuts (TUI)
- [x] Experience level transitions work correctly
- [x] Preferences persist across sessions

### First Run Experience ✅
- [x] FRE appears on first launch (0 sessions)
- [x] FRE can be skipped at any time
- [x] FRE completion persists
- [x] FRE includes all required screens
- [x] Navigation works correctly (keyboard in TUI, mouse in Web)

### Data Persistence ✅
- [x] Preferences saved to database (Web) / JSON (TUI)
- [x] Hint dismissals persist
- [x] Experience level recalculated on load
- [x] FRE completion persists

### Real-time Synchronization ✅
- [x] WebSocket events update preferences
- [x] Multiple clients stay synchronized
- [x] Experience level updates propagate

## Troubleshooting

### TUI Preferences Not Found
- Check `~/.config/clauderon/` directory exists
- Verify file permissions are readable/writable
- Check logs: `tail -f ~/.local/share/clauderon/clauderon.log`

### Web UI Shows Wrong Level
- Clear browser storage: DevTools → Application → Local Storage → Clear
- Check API responses: DevTools → Network → /api/preferences
- Verify WebSocket connection: DevTools → Network → WS tab

### FRE Always Appears
- Check dismissed_hints includes "first-run-complete"
- Verify API endpoint works: `POST /api/preferences/complete-first-run`
- Check browser console for errors

### Experience Level Not Updating
- Verify operations are being tracked: Check network requests
- Confirm database contains user_preferences row
- Check experience level calculation logic in logs

## Performance Checklist

- [ ] FRE modal loads within 500ms
- [ ] Help modal renders without lag
- [ ] Session list renders with 100+ sessions smoothly
- [ ] WebSocket updates apply within 100ms
- [ ] API responses complete within 200ms
- [ ] No memory leaks after 30+ operations

## Documentation Updates

After testing, update:
1. User-facing docs: Explain progressive disclosure to users
2. Developer docs: Document preference system for contributors
3. API docs: Document new preference endpoints
4. Migration guide: How existing users transition to new system
