use crate::core::SessionManager;

use super::protocol::{Request, Response};
use super::types::ReconcileReportDto;

/// Handle an API request
pub async fn handle_request(request: Request, manager: &SessionManager) -> Response {
    match request {
        Request::ListSessions => {
            let sessions = manager.list_sessions().await;
            Response::Sessions(sessions)
        }

        Request::GetSession { id } => manager.get_session(&id).await.map_or_else(
            || {
                tracing::warn!(id = %id, "Session not found");
                Response::Error {
                    code: "NOT_FOUND".to_string(),
                    message: format!("Session not found: {id}"),
                }
            },
            Response::Session,
        ),

        Request::CreateSession(req) => {
            match manager
                .create_session(
                    req.name.clone(),
                    req.repo_path.clone(),
                    req.initial_prompt,
                    req.backend,
                    req.agent,
                    req.dangerous_skip_checks,
                )
                .await
            {
                Ok(session) => {
                    tracing::info!(
                        id = %session.id,
                        name = %session.name,
                        "Session created"
                    );
                    Response::Created {
                        id: session.id.to_string(),
                    }
                }
                Err(e) => {
                    tracing::error!(
                        name = %req.name,
                        repo_path = %req.repo_path,
                        error = %e,
                        "Failed to create session"
                    );
                    Response::Error {
                        code: "CREATE_ERROR".to_string(),
                        message: e.to_string(),
                    }
                }
            }
        }

        Request::DeleteSession { id } => match manager.delete_session(&id).await {
            Ok(()) => {
                tracing::info!(id = %id, "Session deleted");
                Response::Deleted
            }
            Err(e) => {
                tracing::error!(id = %id, error = %e, "Failed to delete session");
                Response::Error {
                    code: "DELETE_ERROR".to_string(),
                    message: e.to_string(),
                }
            }
        },

        Request::ArchiveSession { id } => match manager.archive_session(&id).await {
            Ok(()) => {
                tracing::info!(id = %id, "Session archived");
                Response::Archived
            }
            Err(e) => {
                tracing::error!(id = %id, error = %e, "Failed to archive session");
                Response::Error {
                    code: "ARCHIVE_ERROR".to_string(),
                    message: e.to_string(),
                }
            }
        },

        Request::AttachSession { id } => match manager.get_attach_command(&id).await {
            Ok(command) => {
                tracing::info!(id = %id, "Attach command retrieved");
                Response::AttachReady { command }
            }
            Err(e) => {
                tracing::error!(id = %id, error = %e, "Failed to get attach command");
                Response::Error {
                    code: "ATTACH_ERROR".to_string(),
                    message: e.to_string(),
                }
            }
        },

        Request::Reconcile => match manager.reconcile().await {
            Ok(report) => {
                tracing::info!(
                    missing_worktrees = report.missing_worktrees.len(),
                    missing_backends = report.missing_backends.len(),
                    orphaned_backends = report.orphaned_backends.len(),
                    "Reconciliation complete"
                );
                Response::ReconcileReport(ReconcileReportDto::from(report))
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to reconcile");
                Response::Error {
                    code: "RECONCILE_ERROR".to_string(),
                    message: e.to_string(),
                }
            }
        },

        Request::Subscribe => {
            // TODO: Implement real-time subscriptions
            Response::Subscribed
        }
    }
}
