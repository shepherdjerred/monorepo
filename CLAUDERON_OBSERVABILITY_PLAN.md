# Clauderon Observability & Debuggability Improvement Plan

## Executive Summary

This plan outlines comprehensive improvements to Clauderon's logging, observability, and debuggability. The goal is to make issues significantly easier to diagnose and debug in production and development environments.

## Current State Analysis

### Existing Infrastructure
- **Logging**: tracing + tracing-subscriber with daily file rotation
- **Error Reporting**: Sentry integration for production error tracking
- **Audit Logging**: Structured JSON logging for proxy requests
- **Real-time Events**: WebSocket broadcasting for session updates
- **Log Location**: `~/.clauderon/logs/` with daily rotation
- **Log Level**: Configurable via `RUST_LOG` environment variable (default: `clauderon=info`)

### Current Gaps
1. **No structured spans**: Manual `tracing::info!()` calls without `#[instrument]` macro usage
2. **Limited context propagation**: Errors lack correlation IDs and operation context
3. **Inconsistent error context**: Some errors use `.context()`, many don't
4. **No request/operation tracking**: Difficult to trace operations across async boundaries
5. **Minimal metrics**: No performance metrics, resource usage tracking
6. **Frontend error handling**: Basic error display, no detailed error information
7. **Test observability**: Limited logging in tests makes debugging test failures difficult

## Proposed Improvements

### 1. Structured Logging with Spans

**Goal**: Automatically capture operation context and timing using tracing spans.

**Implementation**:
- Add `#[instrument]` macro to all public functions in:
  - `core/manager.rs` - Session lifecycle operations
  - `backends/*.rs` - All backend operations
  - `proxy/*.rs` - Proxy operations
  - `api/handlers.rs` - API request handlers
  - `store/sqlite.rs` - Database operations

- Configure span attributes to capture:
  - Operation name
  - Session ID (where applicable)
  - User context
  - Duration (automatic with spans)
  - Input parameters (selective, avoiding sensitive data)

**Example transformation**:
```rust
// Before
pub async fn create_session(&self, repo_path: String) -> anyhow::Result<Session> {
    tracing::info!("Creating session for repo: {}", repo_path);
    // ...
}

// After
#[instrument(skip(self), fields(repo_path = %repo_path))]
pub async fn create_session(&self, repo_path: String) -> anyhow::Result<Session> {
    // Automatic span entry/exit logging with timing
    // ...
}
```

**Benefits**:
- Automatic timing for all operations
- Nested span context (parent-child relationships)
- Easier to trace operation flows
- Reduced manual logging code

### 2. Request/Operation Correlation IDs

**Goal**: Track operations across async boundaries and through the entire system.

**Implementation**:
- Generate correlation ID for each:
  - API request (HTTP/WebSocket)
  - Session creation
  - Backend operation
  - Proxy request (already has request_id, extend usage)

- Propagate correlation IDs through:
  - Tracing span fields
  - Error context
  - WebSocket events
  - Audit logs

- Add correlation ID to all log statements automatically via span context

**Data structures**:
```rust
// Add to relevant contexts
pub struct OperationContext {
    pub correlation_id: Uuid,
    pub session_id: Option<Uuid>,
    pub operation: String,
    pub started_at: DateTime<Utc>,
}
```

**Benefits**:
- Easy grep/filter logs by correlation ID
- Trace complete operation lifecycle
- Identify slow operations
- Debug distributed operations (proxy, backend, etc.)

### 3. Enhanced Error Context

**Goal**: Every error should have sufficient context to debug without additional investigation.

**Implementation**:
- Use `.context()` consistently throughout codebase
- Add custom error types for common failure modes:
  ```rust
  #[derive(Debug, thiserror::Error)]
  pub enum SessionError {
      #[error("Session {session_id} not found")]
      NotFound { session_id: Uuid },

      #[error("Backend {backend:?} failed to start session {session_id}: {source}")]
      BackendStartFailed {
          session_id: Uuid,
          backend: BackendType,
          #[source]
          source: anyhow::Error,
      },

      #[error("Git worktree creation failed for session {session_id} at {path}: {source}")]
      WorktreeCreationFailed {
          session_id: Uuid,
          path: PathBuf,
          #[source]
          source: anyhow::Error,
      },
  }
  ```

- Add error context fields:
  - Operation being performed
  - Relevant IDs (session, backend, user)
  - State information
  - Timestamps
  - Related resource paths

**Benefits**:
- Self-documenting errors
- Faster root cause identification
- Better Sentry error grouping
- Improved user error messages

### 4. Performance Metrics

**Goal**: Track system performance and resource usage.

**Implementation**:
- Add metrics using `metrics` crate with tracing integration
- Track:
  - **Session metrics**:
    - Creation duration
    - Active session count
    - Session state transitions
    - Session lifetime
  - **Backend metrics**:
    - Operation latency (start, stop, attach)
    - Backend health status
    - Resource usage per backend
  - **Proxy metrics**:
    - Request count by service
    - Request duration by service
    - Auth injection success/failure rate
    - Filtered request count
  - **Database metrics**:
    - Query duration
    - Connection pool stats
    - Migration timing
  - **API metrics**:
    - Request count by endpoint
    - Response time by endpoint
    - Error rate by endpoint
    - WebSocket connection count

- Export metrics via:
  - Tracing spans (automatically)
  - Periodic log statements
  - Optional Prometheus endpoint (future)

**Benefits**:
- Identify performance bottlenecks
- Track resource leaks
- Capacity planning
- SLA monitoring

### 5. Better Development Logging

**Goal**: Make development and debugging easier with better log output.

**Implementation**:
- Add `RUST_LOG` presets:
  - `RUST_LOG=clauderon=debug` - Verbose application logs
  - `RUST_LOG=clauderon=trace,sqlx=debug` - Include database queries
  - `RUST_LOG=clauderon::proxy=trace` - Deep proxy debugging

- Add pretty console formatting in development:
  ```rust
  // In main.rs for non-production
  if cfg!(debug_assertions) {
      tracing_subscriber::fmt()
          .with_target(true)
          .with_thread_ids(true)
          .with_line_number(true)
          .pretty()
  }
  ```

- Add debug endpoints (development only):
  - `GET /debug/sessions` - Full session state dump
  - `GET /debug/metrics` - Current metrics snapshot
  - `GET /debug/health` - System health check
  - `GET /debug/logs?tail=100` - Recent log entries

**Benefits**:
- Faster local debugging
- Better understanding of system behavior
- Easier onboarding for new contributors

### 6. Test Observability

**Goal**: Make test failures easier to debug.

**Implementation**:
- Initialize tracing in test setup:
  ```rust
  #[cfg(test)]
  pub fn init_test_logging() {
      let _ = tracing_subscriber::fmt()
          .with_test_writer()
          .with_max_level(tracing::Level::DEBUG)
          .try_init();
  }
  ```

- Add logging to mock backends:
  - Log all operations with parameters
  - Log state changes
  - Log assertion failures with context

- Add test helpers for log assertions:
  ```rust
  #[test]
  async fn test_logs_session_creation() {
      let logs = capture_logs(|| {
          // test code
      });
      assert!(logs.contains("Creating session"));
  }
  ```

**Benefits**:
- Faster test debugging
- Better test failure diagnostics
- Easier CI/CD debugging

### 7. Frontend Error Display

**Goal**: Show detailed error information in the web UI.

**Implementation**:
- Add error details to API responses:
  ```typescript
  interface ErrorResponse {
    error: string;           // User-friendly message
    details?: string;        // Technical details
    correlationId?: string;  // For support/debugging
    timestamp: string;
    operation?: string;      // What was being attempted
  }
  ```

- Add ErrorDialog component for detailed error display
- Add toast notifications for transient errors
- Add error boundary with correlation ID display
- Add "Report Issue" button that includes correlation ID

**Benefits**:
- Users can report issues with context
- Support team can debug with correlation IDs
- Better user experience

### 8. Audit Log Enhancements

**Goal**: Extend audit logging beyond proxy to cover all system operations.

**Implementation**:
- Create unified audit logger for:
  - Session lifecycle events (create, delete, archive)
  - Access mode changes
  - Backend operations
  - Configuration changes
  - API access patterns

- Audit log format (JSONL):
  ```json
  {
    "timestamp": "2025-01-03T10:00:00Z",
    "correlation_id": "uuid",
    "event_type": "session_created",
    "actor": "user_id_or_system",
    "session_id": "uuid",
    "details": { "backend": "docker", "repo": "/path" },
    "result": "success"
  }
  ```

- Add audit log viewer in web UI (admin feature)

**Benefits**:
- Security auditing
- Compliance requirements
- Debugging user-reported issues
- Usage analytics

## GitHub Actions Code Review Updates

### New Review Criteria Sections

Add the following explicit sections to the code review prompt in `.github/workflows/code-review.yml`:

```yaml
prompt: |
  Review this PR focusing on things linters and typecheckers can't catch:

  - **Architectural fit**: Does this change fit the codebase patterns? Is it in the right place?
  - **Logic errors**: Are there bugs, race conditions, or edge cases that could cause problems?
  - **Security**: Any vulnerabilities that static analysis would miss?
  - **Design**: Is this the right approach? Are there simpler alternatives?
  - **Commit messages**: Are they clear and explain "why"?

  ## 🔍 DEBUGGABILITY & OBSERVABILITY (REQUIRED)

  **Every PR must include appropriate logging and observability features:**

  - **Logging**: Are operations logged at appropriate levels (debug, info, warn, error)?
    - Use `#[instrument]` on public functions for automatic span tracking
    - Add context to errors using `.context()` with relevant details
    - Include correlation IDs for operations that cross boundaries
    - Log state transitions and important events

  - **Error Context**: Do errors have sufficient context for debugging?
    - Error messages must include relevant IDs (session_id, backend_id, etc.)
    - Error messages must describe what was being attempted
    - Errors must include relevant paths, URLs, or configuration values
    - Use custom error types for domain-specific failures

  - **Observability**: Can this code be monitored and debugged in production?
    - Critical paths must have timing information (via spans)
    - Resource operations (file, network, process) must be logged
    - State changes must be observable (via logs or events)
    - Async operations must be traceable across boundaries

  - **Testing Observability**: Do tests log enough information for debugging failures?
    - Test setup must initialize logging
    - Mock implementations must log operations
    - Assertions must include context about what was expected vs actual

  **Block the PR if:**
  - New operations lack appropriate logging
  - Errors lack sufficient context for debugging
  - State transitions are not observable
  - Tests don't initialize logging infrastructure

  ## ✅ AUTOMATED TESTING (REQUIRED)

  **Manual testing is NOT acceptable - all behavior must have automated tests:**

  - **Test Coverage**: Does this PR include tests for the new/modified behavior?
    - New functions must have unit tests
    - New API endpoints must have integration tests
    - Bug fixes must have regression tests
    - State changes must have tests verifying transitions

  - **Test Quality**: Are the tests sufficient and maintainable?
    - Tests must be deterministic (no flaky tests)
    - Tests must use appropriate mocking/isolation
    - Tests must assert on observable behavior, not implementation
    - Tests must cover edge cases and error paths

  - **Within Reason Exceptions**:
    - Pure UI component changes (visual-only)
    - Documentation-only changes
    - Trivial refactorings with existing coverage
    - Changes explicitly marked as prototype/experimental

  **Block the PR if:**
  - New functionality lacks tests
  - Bug fix lacks regression test
  - Tests are flaky or non-deterministic
  - Tests rely on manual verification

  Read the CLAUDE.md file and explore related code to understand context. Use inline comments for specific suggestions. Be direct and concise - if something is fine, don't comment on it.
```

### Update Issue Severity Classification

Modify the severity classification to include observability and testing:

```yaml
- **Critical**: Security vulnerabilities, data loss risks, breaking changes, missing tests for new functionality
- **Major**: Logic errors, race conditions, architectural violations, insufficient error context, missing logging
- **Minor**: Suboptimal patterns, inconsistencies with conventions, verbose logging
- **Nitpick**: Style preferences, minor improvements
```

### Update Approval Criteria

```yaml
## Approval Decision

After your review, determine if this PR should be auto-approved:
- ✅ **Approve** if: No critical, major, or minor issues exist (nitpicks are okay), adequate logging exists, tests are present
- ❌ **Do not approve** if: Any critical, major, or minor issues are found, OR required logging is missing, OR required tests are missing
```

## Implementation Plan

### Phase 1: Core Logging Infrastructure (Week 1)
1. Add `#[instrument]` to SessionManager methods
2. Add correlation ID to OperationContext
3. Enhance error types for SessionError, BackendError
4. Update main.rs logging configuration for better dev experience
5. Add tests to verify logging behavior

**Files to modify**:
- `src/core/manager.rs`
- `src/core/session.rs`
- `src/main.rs`
- Add `src/core/errors.rs`
- Add `src/observability/mod.rs`

### Phase 2: Backend & Store Instrumentation (Week 1-2)
1. Add `#[instrument]` to all backend implementations
2. Add structured errors for backend operations
3. Instrument database operations
4. Add correlation ID propagation
5. Add tests

**Files to modify**:
- `src/backends/*.rs`
- `src/store/sqlite.rs`
- Add `src/backends/errors.rs`

### Phase 3: API & Proxy Instrumentation (Week 2)
1. Add correlation ID to API requests (middleware)
2. Instrument API handlers
3. Extend proxy audit logging
4. Add correlation ID to WebSocket events
5. Add tests

**Files to modify**:
- `src/api/handlers.rs`
- `src/api/http_server.rs`
- `src/api/ws_events.rs`
- `src/proxy/http_proxy.rs`
- `src/proxy/audit.rs`

### Phase 4: Metrics & Performance Tracking (Week 2-3)
1. Add `metrics` crate integration
2. Add performance metrics to critical paths
3. Add resource usage tracking
4. Add debug endpoints
5. Add tests

**Files to modify**:
- `Cargo.toml` (add metrics dependency)
- Add `src/observability/metrics.rs`
- `src/api/http_server.rs` (debug endpoints)
- `src/core/manager.rs` (session metrics)
- `src/proxy/manager.rs` (proxy metrics)

### Phase 5: Frontend & Developer Experience (Week 3)
1. Update API error responses with correlation IDs
2. Add ErrorDialog component
3. Add error boundary
4. Add debug log viewer (admin only)
5. Update documentation

**Files to modify**:
- `web/frontend/src/components/ErrorDialog.tsx` (new)
- `web/frontend/src/components/ErrorBoundary.tsx` (new)
- `web/frontend/src/contexts/SessionContext.tsx`
- `web/shared/src/index.ts` (error types)
- `src/api/protocol.rs` (error response structure)

### Phase 6: GitHub Actions & Documentation (Week 3)
1. Update code-review.yml workflow
2. Update CLAUDE.md with observability guidelines
3. Add OBSERVABILITY.md documentation
4. Update contributing guidelines
5. Add runbook for debugging common issues

**Files to modify**:
- `.github/workflows/code-review.yml`
- `CLAUDE.md`
- Add `packages/clauderon/OBSERVABILITY.md`
- Add `packages/clauderon/DEBUGGING.md`

## Testing Strategy

All improvements must include tests:

1. **Unit tests** for:
   - Error context propagation
   - Correlation ID generation/propagation
   - Metrics collection
   - Span creation and attributes

2. **Integration tests** for:
   - End-to-end correlation ID flow
   - Audit log entries
   - Error responses include correlation IDs
   - WebSocket events include correlation IDs

3. **Test logging** setup:
   - All tests initialize tracing
   - Test failures include captured logs
   - Mock backends log all operations

## Success Criteria

### Quantitative Metrics
- 100% of public functions in core modules use `#[instrument]`
- 100% of errors include operation context
- All API endpoints emit correlation IDs
- Test coverage remains >80%
- Zero new clippy warnings

### Qualitative Metrics
- Developers can trace operations end-to-end using correlation IDs
- Error messages are self-explanatory
- Test failures show relevant context in logs
- Production issues can be debugged from logs alone
- Code review workflow enforces observability standards

## Architectural Considerations

### Trade-offs

**Pros**:
- Significantly easier debugging
- Better production monitoring
- Faster issue resolution
- Better code quality enforcement
- Improved developer experience

**Cons**:
- Increased log volume (mitigated by log levels)
- Slight performance overhead (negligible with async spans)
- More code (offset by reduced manual logging)
- Learning curve for #[instrument] macro

### Performance Impact

- Tracing spans: <1% overhead in async code
- Correlation ID generation: negligible (UUID v4)
- Metrics collection: <0.1% overhead
- Audit logging: async, non-blocking

### Backwards Compatibility

- All changes are additive
- Existing logs continue to work
- API responses extended, not changed
- No breaking changes to public APIs

## Dependencies

New crate dependencies:
- `metrics` (already have tracing, no new deps needed for Phase 1-3)
- Consider `tracing-opentelemetry` for future distributed tracing

## Future Enhancements

1. **Distributed Tracing**: OpenTelemetry integration for multi-service tracing
2. **Metrics Export**: Prometheus endpoint for metrics scraping
3. **Log Aggregation**: Integration with log aggregation services (Loki, etc.)
4. **Alerting**: Automated alerting on error patterns
5. **Performance Profiling**: Continuous performance regression detection
6. **User Session Tracking**: Track user operations across sessions

## Documentation Updates

All documentation must be updated to reflect new patterns:
- CLAUDE.md: Add observability guidelines
- OBSERVABILITY.md: New file explaining observability infrastructure
- DEBUGGING.md: New file with debugging runbook
- Contributing guide: Add logging/testing requirements
- API documentation: Document correlation IDs and error formats

## Rollout Strategy

1. **Development**: Implement in feature branch with comprehensive tests
2. **Internal Testing**: Validate on development sessions
3. **Documentation**: Update all docs before merge
4. **Code Review**: GHA workflow updates go live with the merge
5. **Monitoring**: Watch for log volume and performance impact
6. **Iteration**: Gather feedback and adjust log levels/spans as needed

## Conclusion

These improvements will make Clauderon significantly easier to debug and monitor. The combination of structured logging, correlation IDs, enhanced error context, and enforced testing standards will reduce time-to-resolution for issues and improve overall code quality.

The GitHub Actions code review workflow updates will ensure that all future PRs maintain these observability standards, preventing regression and building a culture of debuggability-first development.
