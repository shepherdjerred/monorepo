// Build scripts run on the Linux host, so a Windows build also needs a host
// linker; this sample fails if the image lacks one.
fn main() {
    println!("cargo:rustc-env=HELLO_BUILD_HOST={}", std::env::var("HOST").unwrap_or_default());
}
