//! Der Timer läuft in der Oberfläche, aber Windows drosselt Webseiten in
//! minimierten Fenstern. Damit ein Phasenende trotzdem sekundengenau erkannt
//! wird, plant das Backend einen Weckruf (`timer://alarm`) und aktualisiert
//! Tray-Tooltip und Fortschrittsanzeige in der Taskleiste selbst.

use serde::Deserialize;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Emitter, Manager, State};

pub const TRAY_ID: &str = "fokus-tray";

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerDisplay {
    /// z. B. "Lernphase" oder "Kurze Pause"
    pub label: String,
    pub running: bool,
    pub ends_at_ms: i64,
    pub remaining_ms: i64,
    pub total_ms: i64,
    /// Aktiv = Timer läuft oder ist pausiert (nicht im Leerlauf)
    pub active: bool,
}

#[derive(Default)]
pub struct TimerState {
    display: Mutex<TimerDisplay>,
    generation: Mutex<u64>,
    last_rendered: Mutex<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn fmt_ms(ms: i64) -> String {
    let total = (ms.max(0) + 999) / 1000;
    format!("{:02}:{:02}", total / 60, total % 60)
}

#[tauri::command]
pub fn timer_sync(app: AppHandle, state: State<'_, TimerState>, display: TimerDisplay) -> Result<(), String> {
    let generation = {
        let mut g = state.generation.lock().map_err(|e| e.to_string())?;
        *g += 1;
        *g
    };
    let running = display.running;
    let ends_at = display.ends_at_ms;
    *state.display.lock().map_err(|e| e.to_string())? = display;
    render(&app);

    if running {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let wait = (ends_at - now_ms()).max(0) as u64;
            tokio::time::sleep(Duration::from_millis(wait)).await;
            let still_current = handle
                .state::<TimerState>()
                .generation
                .lock()
                .map(|g| *g == generation)
                .unwrap_or(false);
            if still_current {
                let _ = handle.emit("timer://alarm", ends_at);
            }
        });
    }
    Ok(())
}

/// Aktualisiert Tooltip und Taskleisten-Fortschritt (nur bei Änderungen).
fn render(app: &AppHandle) {
    let state = app.state::<TimerState>();
    let Ok(d) = state.display.lock().map(|d| d.clone()) else { return };

    let remaining = if d.running { d.ends_at_ms - now_ms() } else { d.remaining_ms };
    let tooltip = if !d.active {
        "Fokus".to_string()
    } else if d.running {
        format!("Fokus – {} · noch {}", d.label, fmt_ms(remaining))
    } else {
        format!("Fokus – {} · pausiert ({})", d.label, fmt_ms(remaining))
    };
    let progress = if d.active && d.total_ms > 0 {
        (((d.total_ms - remaining).max(0) as f64 / d.total_ms as f64) * 100.0).round() as u64
    } else {
        0
    };
    let key = format!("{tooltip}|{progress}|{}", d.running);
    if let Ok(mut last) = state.last_rendered.lock() {
        if *last == key {
            return;
        }
        *last = key;
    }

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(&tooltip));
    }
    if let Some(win) = app.get_webview_window("main") {
        let status = if !d.active {
            ProgressBarStatus::None
        } else if d.running {
            ProgressBarStatus::Normal
        } else {
            ProgressBarStatus::Paused
        };
        let _ = win.set_progress_bar(ProgressBarState {
            status: Some(status),
            progress: if d.active { Some(progress.min(100)) } else { None },
        });
    }
}

/// Hintergrundschleife: jede Sekunde Tooltip/Fortschritt nachführen.
pub fn spawn_render_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            render(&app);
        }
    });
}
