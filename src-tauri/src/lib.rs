mod blocker;
mod net;
mod spotify;
mod storage;
mod timer;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct AppFlags {
    close_to_tray: AtomicBool,
    quitting: AtomicBool,
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Bittet die Oberfläche, offene Änderungen zu speichern und sich dann über
/// `quit_app` zu beenden. Reagiert sie nicht, wird nach 4 s trotzdem beendet.
fn request_quit(app: &AppHandle) {
    let _ = app.emit("app://quit-requested", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        if !handle.state::<AppFlags>().quitting.load(Ordering::SeqCst) {
            do_quit(&handle);
        }
    });
}

fn do_quit(app: &AppHandle) {
    app.state::<AppFlags>().quitting.store(true, Ordering::SeqCst);
    blocker::clear_silently();
    storage::release_lock(app);
    app.exit(0);
}

#[tauri::command]
fn set_close_to_tray(flags: State<'_, AppFlags>, enabled: bool) {
    flags.close_to_tray.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    do_quit(&app);
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let allowed = ["https://", "http://", "spotify:", "mailto:"];
    if !allowed.iter().any(|p| url.starts_with(p)) {
        return Err("Adresse nicht erlaubt".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn device_name() -> String {
    storage::device_name()
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Fokus öffnen", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Start / Pause", true, None::<&str>)?;
    let skip = MenuItem::with_id(app, "skip", "Phase überspringen", true, None::<&str>)?;
    let mini = MenuItem::with_id(app, "mini", "Mini-Timer", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &toggle, &skip, &mini, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id(timer::TRAY_ID)
        .tooltip("Fokus")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "toggle" => {
                let _ = app.emit("tray://toggle", ());
            }
            "skip" => {
                let _ = app.emit("tray://skip", ());
            }
            "mini" => {
                show_main(app);
                let _ = app.emit("tray://mini", ());
            }
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .manage(AppFlags::default())
        .manage(timer::TimerState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(storage::init(&handle));
            // Falls die App zuvor abgestürzt ist, keine Seiten gesperrt lassen.
            blocker::clear_silently();
            build_tray(&handle)?;
            timer::spawn_render_loop(handle.clone());
            if !std::env::args().any(|a| a == "--minimized") {
                show_main(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let flags = app.state::<AppFlags>();
                if flags.quitting.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                if flags.close_to_tray.load(Ordering::SeqCst) {
                    let _ = window.hide();
                    let _ = app.emit("app://hidden-to-tray", ());
                } else {
                    request_quit(app);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            quit_app,
            open_external,
            open_folder,
            device_name,
            storage::storage_info,
            storage::storage_retry,
            storage::storage_use_default,
            storage::storage_inspect_dir,
            storage::storage_set_dir,
            storage::data_load,
            storage::data_save,
            storage::data_revision,
            storage::data_backup,
            storage::backup_list,
            storage::backup_read,
            storage::lock_heartbeat,
            storage::lock_release,
            storage::music_import,
            storage::music_delete,
            storage::read_text_file,
            storage::write_text_file,
            timer::timer_sync,
            blocker::blocker_status,
            blocker::blocker_apply,
            blocker::blocker_clear,
            blocker::blocker_setup,
            blocker::blocker_teardown,
            spotify::spotify_authorize,
            spotify::spotify_token,
            net::http_get_text,
        ])
        .build(tauri::generate_context!())
        .expect("Fokus konnte nicht gestartet werden");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            blocker::clear_silently();
            storage::release_lock(handle);
        }
    });
}
