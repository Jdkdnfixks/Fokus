//! Lautheitsmessung eigener Musik (EBU R128 / ITU-R BS.1770, in LUFS).
//!
//! Dasselbe Maß nutzt Spotify für seine Lautstärke-Normalisierung. Fokus misst
//! jede Datei einmal und gleicht sie beim Abspielen auf denselben Pegel an –
//! die Datei selbst bleibt unverändert.

use std::fs::File;
use std::path::Path;

use ebur128::{Channel, EbuR128, Mode};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Messergebnis: integrierte Lautheit (LUFS) und höchster Ausschlag (linear, 1.0 = Vollaussteuerung).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Measurement {
    pub lufs: f64,
    pub peak: f64,
}

/// Misst Lautheit und Spitzenpegel einer Audiodatei.
/// `Ok(None)`, wenn die Datei still ist oder ihr Format nicht gelesen werden kann.
pub fn measure(path: &Path) -> Result<Option<Measurement>, String> {
    let file = File::open(path).map_err(err)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let Ok(probed) = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    ) else {
        return Ok(None);
    };
    let mut format = probed.format;
    let Some(track) = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
    else {
        return Ok(None);
    };
    let track_id = track.id;
    let Ok(mut decoder) =
        symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default())
    else {
        return Ok(None);
    };

    let mut meter: Option<EbuR128> = None;
    let mut samples: Option<SampleBuffer<f32>> = None;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            // Dateiende (oder ein Kettenwechsel, den wir nicht weiter verfolgen)
            Err(Error::IoError(_)) | Err(Error::ResetRequired) => break,
            Err(e) => return Err(err(e)),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            // einzelne beschädigte Blöcke überspringen
            Err(Error::DecodeError(_)) => continue,
            Err(Error::IoError(_)) => break,
            Err(e) => return Err(err(e)),
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count() as u32;
        if decoded.frames() == 0 || channels == 0 {
            continue;
        }
        let m = match meter.as_mut() {
            Some(m) => m,
            None => {
                let mut m = EbuR128::new(channels, spec.rate, Mode::I | Mode::SAMPLE_PEAK).map_err(err)?;
                if channels == 1 {
                    // Mono wird auf beiden Lautsprechern abgespielt
                    m.set_channel(0, Channel::DualMono).map_err(err)?;
                }
                meter.insert(m)
            }
        };
        if m.channels() != channels || m.rate() != spec.rate {
            continue;
        }
        if samples.as_ref().map_or(true, |b| b.capacity() < decoded.capacity() * channels as usize) {
            samples = Some(SampleBuffer::new(decoded.capacity() as u64, spec));
        }
        let buf = samples.as_mut().expect("Puffer angelegt");
        buf.copy_interleaved_ref(decoded);
        m.add_frames_f32(buf.samples()).map_err(err)?;
    }

    let Some(m) = meter else { return Ok(None) };
    let lufs = m.loudness_global().map_err(err)?;
    if !lufs.is_finite() {
        return Ok(None);
    }
    let mut peak: f64 = 0.0;
    for ch in 0..m.channels() {
        peak = peak.max(m.sample_peak(ch).map_err(err)?);
    }
    Ok(Some(Measurement {
        lufs: (lufs * 100.0).round() / 100.0,
        peak: (peak * 10_000.0).round() / 10_000.0,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Schreibt einen 1-kHz-Sinus als 16-Bit-WAV.
    fn sine_wav(path: &Path, channels: u16, amplitude: f64, seconds: u32) {
        let rate: u32 = 48_000;
        let frames = rate * seconds;
        let data_len = frames * channels as u32 * 2;
        let mut out = Vec::with_capacity(44 + data_len as usize);
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
        out.extend_from_slice(&(channels * 2).to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        for i in 0..frames {
            let v = amplitude * (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / rate as f64).sin();
            let s = (v * i16::MAX as f64).round() as i16;
            for _ in 0..channels {
                out.extend_from_slice(&s.to_le_bytes());
            }
        }
        File::create(path).unwrap().write_all(&out).unwrap();
    }

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("fokus-loudness-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn measures_sine_in_lufs() {
        // Stereo-Sinus mit Amplitude 0,1 (−20 dBFS) ergibt −20 LUFS
        let p = temp("stereo.wav");
        sine_wav(&p, 2, 0.1, 5);
        let m = measure(&p).unwrap().unwrap();
        assert!((m.lufs + 20.0).abs() < 0.2, "gemessen: {m:?}");
        assert!((m.peak - 0.1).abs() < 0.002, "Spitze: {m:?}");

        // 6 dB leiser → 6 LU weniger
        let q = temp("leise.wav");
        sine_wav(&q, 2, 0.05, 5);
        let m2 = measure(&q).unwrap().unwrap();
        assert!((m.lufs - m2.lufs - 6.02).abs() < 0.2, "{m:?} / {m2:?}");
        assert!((m2.peak - 0.05).abs() < 0.002, "Spitze: {m2:?}");
    }

    #[test]
    fn mono_counts_like_both_speakers() {
        let p = temp("mono.wav");
        sine_wav(&p, 1, 0.1, 5);
        let m = measure(&p).unwrap().unwrap();
        assert!((m.lufs + 20.0).abs() < 0.2, "gemessen: {m:?}");
    }

    #[test]
    fn silence_and_garbage_give_none() {
        let p = temp("still.wav");
        sine_wav(&p, 2, 0.0, 2);
        assert_eq!(measure(&p).unwrap(), None);

        let g = temp("kaputt.mp3");
        File::create(&g).unwrap().write_all(b"keine Musik").unwrap();
        assert_eq!(measure(&g).unwrap(), None);
    }

    /// Geschwindigkeit mit einer echten Datei prüfen:
    /// `FOKUS_BENCH_FILE=… cargo test --release bench_file -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_file() {
        let Ok(p) = std::env::var("FOKUS_BENCH_FILE") else { return };
        let start = std::time::Instant::now();
        let l = measure(Path::new(&p)).unwrap();
        println!("{p}: {l:?} in {:?}", start.elapsed());
    }
}
