//! Auth Proxy Module
//!
//! Zero-trust credential management for containers. The container has no credentials -
//! the proxy intercepts requests and injects auth headers.

mod audit;
mod ca;
mod config;
mod container_config;
mod filter;
mod http_proxy;
mod k8s_proxy;
mod manager;
mod port_allocator;
mod rules;
mod talos_gateway;

pub use audit::{AuditEntry, AuditLogger};
pub use ca::ProxyCa;
pub use config::{Credentials, ProxyConfig};
pub use container_config::generate_container_configs;
pub use filter::is_write_operation;
pub use http_proxy::HttpAuthProxy;
pub use k8s_proxy::KubernetesProxy;
pub use manager::ProxyManager;
pub use port_allocator::PortAllocator;
pub use rules::{find_matching_rule, Rule};
pub use talos_gateway::TalosGateway;
