// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // 单实例：再次启动时只把已有窗口唤到前台，不再开第二个进程
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let state = note_desktop_lib::init_state(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            note_desktop_lib::commands::vault_root,
            note_desktop_lib::commands::open_external,
            note_desktop_lib::commands::open_local_file,
            note_desktop_lib::commands::save_archive,
            note_desktop_lib::commands::open_recycle_bin,
            note_desktop_lib::commands::reveal_path,
            note_desktop_lib::commands::fs_exists,
            note_desktop_lib::commands::fs_read_text,
            note_desktop_lib::commands::fs_write_text,
            note_desktop_lib::commands::fs_read_binary,
            note_desktop_lib::commands::fs_write_binary,
            note_desktop_lib::commands::fs_list,
            note_desktop_lib::commands::fs_mkdir,
            note_desktop_lib::commands::fs_trash,
            note_desktop_lib::commands::fs_rename,
            note_desktop_lib::commands::fs_resolve,
            note_desktop_lib::commands::index_upsert,
            note_desktop_lib::commands::index_remove,
            note_desktop_lib::commands::index_search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
