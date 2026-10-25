//! Absturz-Erkennung: Fokus merkt sich die letzten Aktionen in einer kleinen
//! Datei. Endet das Programm unerwartet – durch einen Fehler oder weil es von
//! außen beendet wurde (z. B. vom Virenschutz) –, zeigt Fokus beim nächsten
//! Start, was kurz davor passiert ist.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const FILE: &str = "diagnose.json";
const MAX_EVENTS: usize = 40;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub at: i64,
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Report {
    pub version: String,
    pub started_at: i64,
    /// letztes Lebenszeichen (spätestens alle 10 Sekunden aktualisiert)
    pub last_alive: i64,
    /// regulär beendet
    pub clean_exit: bool,
    /// Beenden war angekündigt (z. B. für ein Update)
    pub expected_exit: bool,
    pub events: Vec<Event>,
    /// Programmfehler, falls Fokus daran gescheitert ist
    pub panic: Option<String>,
}

struct Diag {
    path: PathBuf,
    report: Report,
    previous: Option<Report>,
}

static DIAG: OnceLock<Mutex<Diag>> = OnceLock::new();

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Bericht der vorigen Sitzung lesen – nur wenn sie unerwartet geendet hat.
fn read_unclean(path: &Path) -> Option<Report> {
    let text = std::fs::read_to_string(path).ok()?;
    let report: Report = serde_json::from_str(&text).ok()?;
    (!report.clean_exit && !report.expected_exit && report.started_at > 0).then_some(report)
}

fn write(d: &Diag) {
    if let Ok(json) = serde_json::to_string(&d.report) {
        let _ = std::fs::write(&d.path, json);
    }
}

fn with(f: impl FnOnce(&mut Diag)) {
    if let Some(m) = DIAG.get() {
        if let Ok(mut d) = m.lock() {
            f(&mut d);
            write(&d);
        }
    }
}

/// Beim Start aufrufen: liest den Bericht der vorigen Sitzung und beginnt einen neuen.
pub fn init(dir: &Path, version: &str) {
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join(FILE);
    let previous = read_unclean(&path);
    let now = now_ms();
    let diag = Diag {
        path,
        report: Report {
            version: version.to_string(),
            started_at: now,
            last_alive: now,
            ..Default::default()
        },
        previous,
    };
    write(&diag);
    if DIAG.set(Mutex::new(diag)).is_ok() {
        install_panic_hook();
    }
}

/// Eine Aktion festhalten (z. B. „Website-Blocker: hosts-Datei geschrieben“).
pub fn event(text: impl Into<String>) {
    let text = text.into();
    with(|d| {
        let now = now_ms();
        d.report.last_alive = now;
        d.report.events.push(Event { at: now, text });
        let extra = d.report.events.len().saturating_sub(MAX_EVENTS);
        d.report.events.drain(..extra);
    });
}

/// Lebenszeichen, damit sich der Zeitpunkt eines Absturzes eingrenzen lässt.
pub fn heartbeat() {
    with(|d| d.report.last_alive = now_ms());
}

pub fn clean_exit() {
    with(|d| {
        d.report.clean_exit = true;
        d.report.last_alive = now_ms();
    });
}

fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unbekannter Fehler".into());
        let location = info.location().map(|l| format!(" ({}:{})", l.file(), l.line())).unwrap_or_default();
        // try_lock: Die Panik kann auftreten, während der Bericht gerade gesperrt ist.
        if let Some(m) = DIAG.get() {
            if let Ok(mut d) = m.try_lock() {
                d.report.panic = Some(format!("{msg}{location}"));
                d.report.last_alive = now_ms();
                write(&d);
            }
        }
        default(info);
    }));
}

/// Bericht der vorigen Sitzung, wenn sie unerwartet geendet hat.
#[tauri::command]
pub fn diag_previous() -> Option<Report> {
    DIAG.get()?.lock().ok()?.previous.clone()
}

/// Aktion aus der Oberfläche festhalten.
#[tauri::command]
pub fn diag_event(text: String) {
    event(text.chars().take(200).collect::<String>());
}

/// Fokus wird gleich absichtlich beendet (z. B. für ein Update).
#[tauri::command]
pub fn diag_expect_exit() {
    with(|d| d.report.expected_exit = true);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_only_unexpected_endings() {
        let dir = std::env::temp_dir().join(format!("fokus-diag-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        let base = Report { version: "1".into(), started_at: 5, last_alive: 9, ..Default::default() };

        std::fs::write(&path, serde_json::to_string(&base).unwrap()).unwrap();
        assert_eq!(read_unclean(&path), Some(base.clone()));

        let clean = Report { clean_exit: true, ..base.clone() };
        std::fs::write(&path, serde_json::to_string(&clean).unwrap()).unwrap();
        assert_eq!(read_unclean(&path), None);

        let update = Report { expected_exit: true, ..base };
        std::fs::write(&path, serde_json::to_string(&update).unwrap()).unwrap();
        assert_eq!(read_unclean(&path), None);

        std::fs::write(&path, "{ kaputt").unwrap();
        assert_eq!(read_unclean(&path), None);
    }
}
