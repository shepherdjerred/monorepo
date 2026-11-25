use std::sync::Arc;

use prometheus_client::encoding::EncodeLabelSet;
use prometheus_client::encoding::text::encode;
use prometheus_client::metrics::counter::Counter;
use prometheus_client::metrics::family::Family;
use prometheus_client::metrics::gauge::Gauge;
use prometheus_client::registry::Registry;

use crate::error::AppError;
use crate::storage::RegistryStats;

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct HttpRequestLabels {
    pub method: String,
    pub route: String,
    pub status: u16,
}

#[derive(Clone)]
pub struct AppMetrics {
    inner: Arc<AppMetricsInner>,
}

struct AppMetricsInner {
    registry: Registry,
    releases_total: Gauge,
    charts_total: Gauge,
    storage_bytes: Gauge,
    quota_bytes: Gauge,
    catalog_revision: Gauge,
    http_requests: Family<HttpRequestLabels, Counter>,
}

impl AppMetrics {
    pub fn new(quota_bytes: u64) -> Self {
        let mut registry = Registry::default();

        let releases_total = Gauge::default();
        let charts_total = Gauge::default();
        let storage_bytes = Gauge::default();
        let quota_gauge = Gauge::default();
        let catalog_revision = Gauge::default();
        let http_requests = Family::<HttpRequestLabels, Counter>::default();

        quota_gauge.set(i64::try_from(quota_bytes).unwrap_or(i64::MAX));

        registry.register(
            "charts_releases_total",
            "Total immutable Helm chart releases stored",
            releases_total.clone(),
        );
        registry.register(
            "charts_charts_total",
            "Total distinct Helm chart names stored",
            charts_total.clone(),
        );
        registry.register(
            "charts_storage_bytes",
            "Total bytes stored across Helm chart archives",
            storage_bytes.clone(),
        );
        registry.register(
            "charts_quota_bytes",
            "Configured storage quota in bytes for Helm chart archives",
            quota_gauge.clone(),
        );
        registry.register(
            "charts_catalog_revision",
            "Monotonic catalog revision incremented on every new release",
            catalog_revision.clone(),
        );
        // Note: `prometheus-client` automatically suffixes Counter metrics with `_total`.
        registry.register(
            "charts_http_requests",
            "Total HTTP requests handled by method, route, and status",
            http_requests.clone(),
        );

        Self {
            inner: Arc::new(AppMetricsInner {
                registry,
                releases_total,
                charts_total,
                storage_bytes,
                quota_bytes: quota_gauge,
                catalog_revision,
                http_requests,
            }),
        }
    }

    pub fn record_request(&self, method: &str, route: &str, status: u16) {
        self.inner
            .http_requests
            .get_or_create(&HttpRequestLabels {
                method: method.to_owned(),
                route: route.to_owned(),
                status,
            })
            .inc();
    }

    pub fn encode_with_stats(
        &self,
        stats: RegistryStats,
        quota_bytes: u64,
    ) -> Result<String, AppError> {
        self.inner.charts_total.set(stats.chart_count);
        self.inner.releases_total.set(stats.release_count);
        self.inner.storage_bytes.set(stats.total_bytes);
        self.inner
            .quota_bytes
            .set(i64::try_from(quota_bytes).unwrap_or(i64::MAX));
        self.inner.catalog_revision.set(stats.catalog_revision);

        let mut buffer = String::new();
        encode(&mut buffer, &self.inner.registry)
            .map_err(|err| AppError::Internal(format!("prometheus encode failed: {err}")))?;
        Ok(buffer)
    }
}
