// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Portable mode: keep everything the app writes in a `data` folder beside the
/// executable instead of under AppData.
///
/// This has to happen before Tauri starts, because the WebView2 runtime reads
/// `WEBVIEW2_USER_DATA_FOLDER` once when it initializes - and that folder is
/// where localStorage lives, which is where nearly all tracker state (checked
/// locations, items, hints, notes, settings) actually sits. Moving only the
/// preferences file would leave the app half-portable.
///
/// Falls back to the default AppData location when the executable's folder
/// isn't writable - an app installed into Program Files must not try to write
/// beside itself, or WebView2 fails to start at all.
#[cfg(target_os = "windows")]
fn use_portable_data_dir() {
    let Ok(exe) = std::env::current_exe() else { return };
    let Some(exe_dir) = exe.parent() else { return };
    let data_dir = exe_dir.join("data");

    if std::fs::create_dir_all(data_dir.join("webview")).is_err() {
        return;
    }

    // create_dir_all can succeed on a path that still refuses file writes, so
    // probe with a real file before committing to portable mode.
    let probe = data_dir.join(".write-test");
    if std::fs::write(&probe, b"").is_err() {
        return;
    }
    let _ = std::fs::remove_file(&probe);

    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", data_dir.join("webview"));
    std::env::set_var("JAWRYTRACKER_PORTABLE_DIR", data_dir);
}

#[cfg(not(target_os = "windows"))]
fn use_portable_data_dir() {}

/// Where the frontend should read/write its preference files. Empty string
/// means portable mode was not available and the app-config directory should
/// be used instead.
#[tauri::command]
fn portable_data_dir() -> String {
    std::env::var("JAWRYTRACKER_PORTABLE_DIR").unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use_portable_data_dir();

    // Auto-update is shelved: this ships portable, and a running .exe can't
    // replace itself on Windows (Tauri's updater installs via NSIS/MSI). The
    // frontend pieces are kept unwired in tauri/updater.ts +
    // UpdateNotice.svelte for whenever it comes back.
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![greet, portable_data_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
