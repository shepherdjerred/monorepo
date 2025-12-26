use serde::{Deserialize, Serialize};
use typeshare::typeshare;
use uuid::Uuid;

use crate::core::manager::ReconcileReport;

/// Serializable reconcile report for API responses
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileReportDto {
    /// Sessions with missing git worktrees
    pub missing_worktrees: Vec<String>,

    /// Sessions with missing backend resources
    pub missing_backends: Vec<String>,

    /// Orphaned backend resources
    pub orphaned_backends: Vec<String>,
}

impl From<ReconcileReport> for ReconcileReportDto {
    fn from(report: ReconcileReport) -> Self {
        Self {
            missing_worktrees: report
                .missing_worktrees
                .iter()
                .map(Uuid::to_string)
                .collect(),
            missing_backends: report
                .missing_backends
                .iter()
                .map(Uuid::to_string)
                .collect(),
            orphaned_backends: report.orphaned_backends,
        }
    }
}
