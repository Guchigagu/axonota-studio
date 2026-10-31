fn main() {
    // 图标改动后必须重跑构建脚本，否则 Windows 可执行文件里嵌的仍是旧图标
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    tauri_build::build()
}
