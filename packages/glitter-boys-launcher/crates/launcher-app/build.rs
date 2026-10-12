fn main() {
    println!("cargo:rerun-if-changed=../../assets/icon.ico");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut resource = winresource::WindowsResource::new();
        resource.set_icon("../../assets/icon.ico");
        if let Err(error) = resource.compile() {
            eprintln!("Could not compile Windows application resources: {error}");
            std::process::exit(1);
        }
    }
}
