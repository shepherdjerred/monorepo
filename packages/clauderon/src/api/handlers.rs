use tokio::io::AsyncWriteExt;
use tokio::net::unix::OwnedWriteHalf;
use tracing::instrument;

use crate::core::SessionManager;

use super::protocol::{CreateSessionRequest, ProgressStep, Request, Response};
use super::types::ReconcileReportDto;

/// Handle an API request
#[allow(
    clippy::too_many_lines,
    reason = "Protocol handler with many request types - splitting would reduce clarity"
)]
#[instrument(skip(manager), fields(request_type = ?std::mem::discriminant(&request)))]
pub async fn handle_request(
    request: Request,
    manager: &std::sync::Arc<SessionManager>,
) -> Response {
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
            // Validate request including experimental models check
            if let Err(e) = req.validate(&manager.feature_flags()) {
                return Response::Error {
                    code: "INVALID_REQUEST".to_string(),
                    message: e.to_string(),
                };
            }

            // Use async creation for multi-repo or when not in print mode
            let use_async = req.repositories.is_some() || !req.print_mode;

            if use_async {
                // Async creation: start background task and return immediately
                match manager
                    .start_session_creation(
                        req.repo_path.clone(),
                        req.repositories.clone(),
                        req.initial_prompt,
                        req.backend,
                        req.agent,
                        req.model.clone(),
                        req.dangerous_skip_checks,
                        req.dangerous_copy_creds,
                        req.print_mode,
                        req.plan_mode,
                        req.access_mode,
                        req.images,
                        req.container_image,
                        req.pull_policy,
                        req.cpu_limit,
                        req.memory_limit,
                        req.storage_class.clone(),
                    )
                    .await
                {
                    Ok(session_id) => {
                        tracing::info!(
                            id = %session_id,
                            "Session creation started (async)"
                        );
                        Response::Created {
                            id: session_id.to_string(),
                            warnings: None,
                        }
                    }
                    Err(e) => {
                        tracing::error!(
                            repo_path = %req.repo_path,
                            error = %e,
                            "Failed to start session creation"
                        );
                        Response::Error {
                            code: "CREATE_ERROR".to_string(),
                            message: e.to_string(),
                        }
                    }
                }
            } else {
                // Synchronous creation for print mode (single repo only)
                match manager
                    .create_session(
                        req.repo_path.clone(),
                        req.repositories.clone(),
                        req.initial_prompt,
                        req.backend,
                        req.agent,
                        req.model.clone(),
                        req.dangerous_skip_checks,
                        req.dangerous_copy_creds,
                        req.print_mode,
                        req.plan_mode,
                        req.access_mode,
                        req.images,
                        req.container_image,
                        req.pull_policy,
                        req.cpu_limit,
                        req.memory_limit,
                        req.storage_class.clone(),
                    )
                    .await
                {
                    Ok((session, warnings)) => {
                        tracing::info!(
                            id = %session.id,
                            name = %session.name,
                            access_mode = ?session.access_mode,
                            warnings = ?warnings,
                            "Session created (sync)"
                        );
                        Response::Created {
                            id: session.id.to_string(),
                            warnings,
                        }
                    }
                    Err(e) => {
                        tracing::error!(
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

        Request::UnarchiveSession { id } => match manager.unarchive_session(&id).await {
            Ok(()) => {
                tracing::info!(id = %id, "Session unarchived");
                Response::Unarchived
            }
            Err(e) => {
                tracing::error!(id = %id, error = %e, "Failed to unarchive session");
                Response::Error {
                    code: "UNARCHIVE_ERROR".to_string(),
                    message: e.to_string(),
                }
            }
        },

        Request::RefreshSession { id } => match manager.refresh_session(&id).await {
            Ok(()) => {
                tracing::info!(id = %id, "Session refreshed");
                Response::Refreshed
            }
            Err(e) => {
                tracing::error!(id = %id, error = %e, "Failed to refresh session");
                Response::Error {
                    code: "REFRESH_ERROR".to_string(),
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

        Request::UpdateAccessMode { id, access_mode } => {
            match manager.update_access_mode(&id, access_mode).await {
                Ok(()) => {
                    tracing::info!(session = %id, mode = ?access_mode, "Access mode updated");
                    Response::AccessModeUpdated
                }
                Err(e) => {
                    tracing::error!(session = %id, error = %e, "Failed to update access mode");
                    Response::Error {
                        code: "UPDATE_ERROR".to_string(),
                        message: e.to_string(),
                    }
                }
            }
        }

        Request::Subscribe => {
            // TODO: Implement real-time subscriptions
            Response::Subscribed
        }

        Request::GetRecentRepos => match manager.get_recent_repos().await {
            Ok(repos) => {
                let repo_dtos: Vec<super::protocol::RecentRepoDto> = repos
                    .into_iter()
                    .map(|r| super::protocol::RecentRepoDto {
                        repo_path: r.repo_path.to_string_lossy().to_string(),
                        subdirectory: r.subdirectory.to_string_lossy().to_string(),
                        last_used: r.last_used.to_rfc3339(),
                    })
                    .collect();
                Response::RecentRepos(repo_dtos)
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to get recent repos");
                Response::Error {
                    code: "RECENT_REPOS_ERROR".to_string(),
                    message: e.to_string(),
                }
            }
        },

        Request::SendPrompt { session, prompt } => {
            match manager.send_prompt_to_session(&session, &prompt).await {
                Ok(()) => {
                    tracing::info!(session = %session, "Prompt sent to session");
                    Response::Ok
                }
                Err(e) => {
                    tracing::error!(session = %session, error = %e, "Failed to send prompt");
                    Response::Error {
                        code: "SEND_PROMPT_ERROR".to_string(),
                        message: e.to_string(),
                    }
                }
            }
        }

        Request::GetSessionIdByName { name } => match manager.get_session(&name).await {
            Some(session) => Response::SessionId {
                session_id: session.id.to_string(),
            },
            None => Response::Error {
                code: "NOT_FOUND".to_string(),
                message: format!("Session not found: {name}"),
            },
        },

        Request::GetFeatureFlags => Response::FeatureFlags {
            flags: (*manager.feature_flags()).clone(),
        },

        Request::GetHealth => {
            let result = manager.check_all_sessions_health().await;
            Response::HealthCheckResult(result)
        }

        Request::GetSessionHealth { id } => {
            let session_id = match uuid::Uuid::parse_str(&id) {
                Ok(id) => id,
                Err(e) => {
                    return Response::Error {
                        code: "INVALID_ID".to_string(),
                        message: format!("Invalid session ID: {e}"),
                    };
                }
            };
            match manager.check_session_health(session_id).await {
                Ok(report) => Response::SessionHealth(report),
                Err(e) => {
                    tracing::error!(id = %id, error = %e, "Failed to check session health");
                    Response::Error {
                        code: "HEALTH_ERROR".to_string(),
                        message: e.to_string(),
                    }
                }
            }
        }

        Request::StartSession { id } => {
            let session_id = match uuid::Uuid::parse_str(&id) {
                Ok(id) => id,
                Err(e) => {
                    return Response::Error {
                        code: "INVALID_ID".to_string(),
                        message: format!("Invalid session ID: {e}"),
                    };
                }
            };
            match manager.start_session(session_id).await {
                Ok(_result) => {
                    tracing::info!(id = %id, "Session started");
                    Response::Started
                }
                Err(e) => {
                    tracing::error!(id = %id, error = %e, "Failed to start session");
                    Response::Error {
                        code: "START_ERROR".to_string(),
                        message: e.to_string(),
                    }
                }
            }
        }

        Request::WakeSession { id } => {
            let session_id = match uuid::Uuid::parse_str(&id) {
                Ok(id) => id,
                Err(e) => {
                    return Response::Error {
                        code: "INVALID_ID".to_string(),
                        message: format!("Invalid session ID: {e}"),
                    };
                }
            };
            match manager.wake_session(session_id).await {
                Ok(_result) => {
                    tracing::info!(id = %id, "Session woken");
                    Response::Woken
                }
                Err(e) => {
                    tracing::error!(id = %id, error = %e, "Failed to wake session");
                    Response::Error {
                        code: "WAKE_ERROR".to_string(),
                        message: e.to_string(),
                    }
                }
            }
        }

        Request::RecreateSession { id } => {
            let session_id = match uuid::Uuid::parse_str(&id) {
                Ok(id) => id,
                Err(e) => {
                    return Response::Error {
                        code: "INVALID_ID".to_string(),
                        message: format!("Invalid session ID: {e}"),
                    };
                }
            };
            match manager.recreate_session(session_id).await {
                Ok(result) => {
                    tracing::info!(id = %id, "Session recreated");
                    Response::Recreated {
                        new_backend_id: Some(result.new_backend_id),
                    }
                }
                Err(crate::core::manager::RecreateError::Blocked(blocked)) => {
                    tracing::warn!(id = %id, reason = %blocked.reason, "Recreate blocked");
                    Response::ActionBlocked {
                        reason: blocked.reason,
                    }
                }
                Err(crate::core::manager::RecreateError::Other(e)) => {
                    tracing::error!(id = %id, error = %e, "Failed to recreate session");
                    Response::Error {
                        code: "RECREATE_ERROR".to_string(),
                        message: e.to_string(),
                    }
                }
            }
        }

        Request::CleanupSession { id } => {
            let session_id = match uuid::Uuid::parse_str(&id) {
                Ok(id) => id,
                Err(e) => {
                    return Response::Error {
                        code: "INVALID_ID".to_string(),
                        message: format!("Invalid session ID: {e}"),
                    };
                }
            };
            match manager.cleanup_session(session_id).await {
                Ok(()) => {
                    tracing::info!(id = %id, "Session cleaned up");
                    Response::CleanedUp
                }
                Err(e) => {
                    tracing::error!(id = %id, error = %e, "Failed to cleanup session");
                    Response::Error {
                        code: "CLEANUP_ERROR".to_string(),
                        message: e.to_string(),
                    }
                }
            }
        }

        Request::RecreateSessionFresh { id } => {
            let session_id = match uuid::Uuid::parse_str(&id) {
                Ok(id) => id,
                Err(e) => {
                    return Response::Error {
                        code: "INVALID_ID".to_string(),
                        message: format!("Invalid session ID: {e}"),
                    };
                }
            };
            match manager.recreate_session_fresh(session_id).await {
                Ok(result) => {
                    tracing::info!(id = %id, "Session recreated fresh");
                    Response::Recreated {
                        new_backend_id: Some(result.new_backend_id),
                    }
                }
                Err(e) => {
                    tracing::error!(id = %id, error = %e, "Failed to recreate session fresh");
                    Response::Error {
                        code: "RECREATE_FRESH_ERROR".to_string(),
                        message: e.to_string(),
                    }
                }
            }
        }
    }
}

/// Send a response line to the client
async fn send_response(writer: &mut OwnedWriteHalf, response: &Response) -> anyhow::Result<()> {
    let json = serde_json::to_string(response)?;
    writer.write_all(json.as_bytes()).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await?;
    Ok(())
}

/// Handle `CreateSession` with progress streaming
///
/// # Errors
///
/// Returns an error if writing to the stream fails or session creation fails.
pub async fn handle_create_session_with_progress(
    req: CreateSessionRequest,
    manager: &SessionManager,
    writer: &mut OwnedWriteHalf,
) -> anyhow::Result<()> {
    let backend_name = match req.backend {
        crate::core::BackendType::Zellij => "Zellij session",
        crate::core::BackendType::Docker => "Docker container",
        crate::core::BackendType::Kubernetes => "Kubernetes pod",
        #[cfg(target_os = "macos")]
        crate::core::BackendType::AppleContainer => "Apple container",
        crate::core::BackendType::Sprites => "Sprites container",
    };

    // Step 1: Creating git worktree
    send_response(
        writer,
        &Response::Progress(ProgressStep {
            step: 1,
            total: 2,
            message: "Creating git worktree...".to_string(),
        }),
    )
    .await?;

    // Actually create the session (this does both steps internally)
    match manager
        .create_session(
            req.repo_path.clone(),
            req.repositories.clone(),
            req.initial_prompt,
            req.backend,
            req.agent,
            req.model.clone(),
            req.dangerous_skip_checks,
            req.dangerous_copy_creds,
            req.print_mode,
            req.plan_mode,
            req.access_mode,
            req.images,
            req.container_image,
            req.pull_policy,
            req.cpu_limit,
            req.memory_limit,
            req.storage_class,
        )
        .await
    {
        Ok((session, warnings)) => {
            // Step 2 was completed (we send it for completeness even though it's done)
            send_response(
                writer,
                &Response::Progress(ProgressStep {
                    step: 2,
                    total: 2,
                    message: format!("Creating {backend_name}..."),
                }),
            )
            .await?;

            tracing::info!(
                id = %session.id,
                name = %session.name,
                warnings = ?warnings,
                "Session created"
            );
            send_response(
                writer,
                &Response::Created {
                    id: session.id.to_string(),
                    warnings,
                },
            )
            .await?;
        }
        Err(e) => {
            tracing::error!(
                repo_path = %req.repo_path,
                error = %e,
                "Failed to create session"
            );
            send_response(
                writer,
                &Response::Error {
                    code: "CREATE_ERROR".to_string(),
                    message: e.to_string(),
                },
            )
            .await?;
        }
    }

    Ok(())
}
