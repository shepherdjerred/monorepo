use std::net::TcpListener;
use crate::structs::config::Config;
use crate::handler::handle_connection;
use crate::thread_pool::thread_pool::ThreadPool;

mod structs;
mod handler;
mod thread_pool;

fn main() {
    let config = Config {
        address: "127.0.0.1".to_string(),
        port: "8080".to_string(),
        thread_pool_size: 16
    };

    run(config);
}

fn make_host(address: String, port: String) -> String {
    [address, port].join(":")
}

fn run(config: Config) {
    let address = config.address;
    let port = config.port;
    let host = make_host(address, port);
    let listener = TcpListener::bind(&host).unwrap();

    println!("Listening on {}", host);

    let thread_pool = ThreadPool::new(config.thread_pool_size);

    for stream in listener.incoming() {
        thread_pool.execute(|| {
            let stream = stream.unwrap();
            handle_connection(stream);
        });
    }
}
