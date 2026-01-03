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

    /// Sessions that were successfully recreated
    pub recreated: Vec<String>,

    /// Sessions that failed to be recreated
    pub recreation_failed: Vec<String>,

    /// Sessions that exceeded max reconcile attempts
    pub gave_up: Vec<String>,
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
            recreated: report.recreated.iter().map(Uuid::to_string).collect(),
            recreation_failed: report
                .recreation_failed
                .iter()
                .map(Uuid::to_string)
                .collect(),
            gave_up: report.gave_up.iter().map(Uuid::to_string).collect(),
        }
    }
}
