//! Auth Proxy Module
//!
//! Zero-trust credential management for containers. The container has no credentials -
//! the proxy intercepts requests and injects auth headers.

// Allow missing documentation for internal proxy implementations
#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

mod audit;
mod ca;
mod codex;
mod config;
mod container_config;
mod filter;
mod http_proxy;
mod kubectl_proxy;
mod manager;
pub mod onepassword;
mod port_allocator;
mod rules;
mod talos_gateway;

pub use audit::{AuditEntry, AuditLogger};
pub use ca::ProxyCa;
pub use codex::{
    DUMMY_ACCESS_TOKEN, DUMMY_ACCOUNT_ID, DUMMY_REFRESH_TOKEN, dummy_auth_json_string,
    dummy_config_toml, dummy_id_token,
};
pub use config::{Credentials, ProxyConfig};
pub use container_config::{
    generate_codex_config, generate_container_configs, generate_plugin_config,
};
pub use filter::{is_read_operation, is_write_operation};
pub use http_proxy::HttpAuthProxy;
pub use kubectl_proxy::KubectlProxy;
pub use manager::ProxyManager;
pub use onepassword::{OnePasswordClient, OpReference};
pub use port_allocator::PortAllocator;
pub use rules::{Rule, find_matching_rule};
pub use talos_gateway::TalosGateway;
