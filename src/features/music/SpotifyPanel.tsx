import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, LogOut, Pause, Play, RefreshCw, Shuffle, SkipBack, SkipForward, Star, Volume2 } from "lucide-react";
import { Slider, toast } from "../../components/ui";
import { isTauri, openExternal } from "../../lib/tauri";
import { useData, useSettings } from "../../store/data";
import {
  SPOTIFY_DASHBOARD,
  SPOTIFY_REDIRECT,
  connectSpotify,
  disconnectSpotify,
  initSpotify,
  loadPlaylists,
  refreshDevices,
  refreshPlayback,
  spotifyNext,
  spotifyPause,
  spotifyPlay,
  spotifyPrev,
  spotifyShuffle,
  spotifyTransfer,
  spotifyVolume,
  useSpotify,
  type SpotifyPlaylist,
} from "./spotify";
import { chooseSpotifyFocusMusic } from "./focusMusic";
import { fmtSeconds } from "./LocalMusic";

export function SpotifyPanel() {
  const connected = useSpotify((s) => s.connected);
  return connected ? <SpotifyConnected /> : <SpotifySetup />;
}

function SpotifySetup() {
  const clientId = useSettings().spotify.clientId;
  const setSettings = useData((s) => s.setSettings);
  const { connecting, error, status } = useSpotify();

  const copy = async () => {
    await navigator.clipboard.writeText(SPOTIFY_REDIRECT).catch(() => {});
    toast("Adresse kopiert.", "success", 1800);
  };

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="col gap-16">
        <div>
          <h2>Spotify verbinden</h2>
          <p className="muted small mt-4">
            Fokus steuert deine Spotify-App fern: Playlists auswählen, abspielen, pausieren. Dafür brauchst du Spotify Premium und legst
            einmalig eine eigene, kostenlose „App“ bei Spotify an. Das dauert etwa zwei Minuten.
          </p>
        </div>
        <ol className="steps">
          <li>
            <div className="col gap-4">
              <span>Öffne das Spotify-Developer-Dashboard und melde dich mit deinem Spotify-Konto an.</span>
              <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => void openExternal(SPOTIFY_DASHBOARD)}>
                <ExternalLink size={14} /> Dashboard öffnen
              </button>
            </div>
          </li>
          <li>
            <div className="col gap-4">
              <span>
                Klicke auf <strong>„Create app“</strong>. Name z. B. „Fokus“, Beschreibung beliebig. Bei <strong>Redirect URIs</strong> trägst
                du genau diese Adresse ein und klickst auf „Add“:
              </span>
              <span className="row">
                <span className="code">{SPOTIFY_REDIRECT}</span>
                <button className="icon-btn sm" onClick={() => void copy()} title="Kopieren">
                  <Copy size={14} />
                </button>
              </span>
              <span>
                Unter „Which API/SDKs are you planning to use?“ wählst du <strong>Web API</strong>, bestätigst die Bedingungen und speicherst.
              </span>
            </div>
          </li>
          <li>
            <div className="col gap-4" style={{ flex: 1 }}>
              <span>
                Öffne in deiner neuen App die <strong>Settings</strong> und kopiere die <strong>Client ID</strong> hierher:
              </span>
              <input
                className="input"
                style={{ maxWidth: 420 }}
                placeholder="z. B. 3f1c9e…"
                value={clientId}
                onChange={(e) => setSettings((s) => ({ ...s, spotify: { clientId: e.target.value.trim() } }))}
              />
            </div>
          </li>
          <li>
            <div className="col gap-4">
              <span>Verbinden – dein Browser öffnet sich kurz für die Anmeldung bei Spotify.</span>
              <button
                className="btn primary"
                style={{ alignSelf: "flex-start" }}
                disabled={!clientId || connecting || !isTauri}
                onClick={() => void connectSpotify()}
              >
                {connecting ? "Warte auf Anmeldung …" : "Mit Spotify verbinden"}
              </button>
            </div>
          </li>
        </ol>
        {status && <div className="banner info">{status}</div>}
        {error && <div className="banner danger">{error}</div>}
        <p className="tiny faint">
          Hinweis: Seit 2026 erlaubt Spotify eigenen Entwickler-Apps höchstens 5 Nutzer, und der Besitzer braucht Premium. Für dich allein
          reicht das völlig. Dein Passwort sieht Fokus nie, die Anmeldung läuft direkt über Spotify. Die Zugangsdaten bleiben nur auf diesem
          Gerät gespeichert.
        </p>
      </div>
    </div>
  );
}

function SpotifyConnected() {
  const { profile, devices, preferredDevice, playlists, playback, error, status } = useSpotify();
  const music = useSettings().music;
  const [volume, setVolume] = useState<number | null>(null);
  const volTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void initSpotify();
  }, []);

  const setFocusPlaylist = (p: SpotifyPlaylist) => {
    chooseSpotifyFocusMusic(p.uri, p.name);
    toast(`„${p.name}“ läuft ab jetzt in deinen Lernphasen.`, "success");
  };

  const onVolume = (v: number) => {
    setVolume(v);
    if (volTimer.current) clearTimeout(volTimer.current);
    volTimer.current = setTimeout(() => void spotifyVolume(v), 250);
  };

  const activeDevice = devices.find((d) => d.isActive)?.id ?? preferredDevice ?? "";
  const progress = playback ? Math.min(playback.durationMs, playback.progressMs + (playback.isPlaying ? Date.now() - playback.fetchedAt : 0)) : 0;

  return (
    <div className="col gap-16">
      <div className="card tight">
        <div className="row between wrap">
          <div className="row gap-12">
            <span className="spotify-dot" />
            <div className="col" style={{ gap: 0 }}>
              <span className="small strong">Verbunden als {profile?.name ?? "…"}</span>
              <span className="tiny faint">{profile?.product === "premium" ? "Spotify Premium" : profile?.product ? `Konto: ${profile.product}` : ""}</span>
            </div>
          </div>
          <div className="row gap-8">
            <select
              className="select sm"
              style={{ width: 200 }}
              value={activeDevice}
              onChange={(e) => e.target.value && void spotifyTransfer(e.target.value)}
            >
              <option value="">{devices.length ? "Gerät wählen …" : "Kein Gerät gefunden"}</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.isActive ? "· aktiv" : ""}
                </option>
              ))}
            </select>
            <button className="icon-btn" onClick={() => void refreshDevices()} title="Geräte aktualisieren">
              <RefreshCw size={15} />
            </button>
            <button className="btn sm" onClick={() => void openExternal("spotify:")}>
              Spotify öffnen
            </button>
            <button className="btn sm ghost" onClick={disconnectSpotify}>
              <LogOut size={14} /> Trennen
            </button>
          </div>
        </div>
      </div>

      {status && <div className="banner info">{status}</div>}
      {error && <div className="banner danger">{error}</div>}

      <div className="card now-card">
        {playback?.image ? <img className="now-cover" src={playback.image} alt="" /> : <div className="now-cover" />}
        <div className="col grow" style={{ minWidth: 0, gap: 4 }}>
          <span className="tiny faint">{playback?.deviceName ? `Wiedergabe auf ${playback.deviceName}` : "Gerade nichts aktiv"}</span>
          <span className="strong ellipsis" style={{ fontSize: 16 }}>
            {playback?.track ?? "Wähle unten eine Playlist"}
          </span>
          <span className="small muted ellipsis">{playback?.artists ?? ""}</span>
          {playback && (
            <div className="row gap-8 mt-4">
              <span className="tiny faint tabular">{fmtSeconds(progress / 1000)}</span>
              <div className="progress grow">
                <span style={{ width: `${playback.durationMs ? (progress / playback.durationMs) * 100 : 0}%` }} />
              </div>
              <span className="tiny faint tabular">{fmtSeconds(playback.durationMs / 1000)}</span>
            </div>
          )}
        </div>
        <div className="col" style={{ alignItems: "center", gap: 8 }}>
          <div className="row gap-4">
            <button className={`icon-btn sm ${playback?.shuffle ? "active" : ""}`} onClick={() => void spotifyShuffle(!playback?.shuffle)} title="Zufällig">
              <Shuffle size={14} />
            </button>
            <button className="icon-btn" onClick={() => void spotifyPrev()} title="Zurück">
              <SkipBack size={16} />
            </button>
            <button
              className="play-circle"
              onClick={() => void (playback?.isPlaying ? spotifyPause() : spotifyPlay(null))}
              title={playback?.isPlaying ? "Pause" : "Abspielen"}
            >
              {playback?.isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
            </button>
            <button className="icon-btn" onClick={() => void spotifyNext()} title="Weiter">
              <SkipForward size={16} />
            </button>
            <button className="icon-btn sm" onClick={() => void refreshPlayback()} title="Aktualisieren">
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="row gap-8" style={{ width: 170 }}>
            <Volume2 size={14} className="faint" />
            <Slider value={volume ?? playback?.volume ?? 50} min={0} max={100} step={1} onChange={onVolume} ariaLabel="Spotify-Lautstärke" />
          </div>
        </div>
      </div>

      <div className="row between">
        <h3>Deine Playlists</h3>
        <button className="btn sm ghost" onClick={() => void loadPlaylists()}>
          <RefreshCw size={13} /> Neu laden
        </button>
      </div>
      <div className="playlist-grid">
        {playlists.map((p) => {
          const isFocus = music.spotifyUri === p.uri;
          const isPlaying = playback?.contextUri === p.uri && playback.isPlaying;
          return (
            <div key={p.id} className={`playlist-card ${isFocus ? "focus" : ""}`}>
              <div className="playlist-cover">
                {p.image ? <img src={p.image} alt="" loading="lazy" /> : null}
                <button
                  className="play-circle overlay"
                  onClick={() => void (isPlaying ? spotifyPause() : spotifyPlay(p.uri))}
                  title={isPlaying ? "Pause" : "Abspielen"}
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
                </button>
              </div>
              <div className="row between top" style={{ gap: 4 }}>
                <div className="col" style={{ gap: 0, minWidth: 0 }}>
                  <span className="small strong ellipsis">{p.name}</span>
                  <span className="tiny faint ellipsis">
                    {p.owner}
                    {p.total ? ` · ${p.total} Titel` : ""}
                  </span>
                </div>
                <button
                  className={`icon-btn sm ${isFocus ? "active" : ""}`}
                  onClick={() => setFocusPlaylist(p)}
                  title={isFocus ? "Deine Lernmusik" : "Als Lernmusik festlegen"}
                >
                  <Star size={14} fill={isFocus ? "currentColor" : "none"} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {!playlists.length && <p className="small faint">Keine Playlists gefunden. Lege in Spotify eine Playlist an oder folge einer.</p>}
    </div>
  );
}
