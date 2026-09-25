use std::time::Duration;

/// Lädt eine Textdatei aus dem Internet, z. B. einen iCal-Kalender (.ics).
/// Läuft im Backend, weil viele Kalenderserver keine Browser-Anfragen (CORS) erlauben.
#[tauri::command]
pub async fn http_get_text(url: String) -> Result<String, String> {
    let url = if let Some(rest) = url.trim().strip_prefix("webcal://") {
        format!("https://{rest}")
    } else {
        url.trim().to_string()
    };
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Bitte eine http(s)- oder webcal-Adresse angeben.".into());
    }
    let res = reqwest::Client::new()
        .get(&url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Abruf fehlgeschlagen: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Server antwortet mit {}", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}
