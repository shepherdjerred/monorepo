fn main() {
    println!(
        "Hello from Rust on {}, built on {}",
        std::env::consts::ARCH,
        env!("HELLO_BUILD_HOST")
    );
}
