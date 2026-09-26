import { Coffee, GraduationCap } from "lucide-react";
import { Segmented, Stepper, Switch } from "../../components/ui";
import { useData, useSettings } from "../../store/data";
import type { LocalPlaylist, Settings } from "../../store/types";
import {
  chooseBreakSource,
  chooseFocusSource,
  chooseLocalBreakMusic,
  chooseLocalFocusMusic,
  chooseSpotifyBreakMusic,
  chooseSpotifyFocusMusic,
} from "./focusMusic";
import { useSpotify, type SpotifyPlaylist } from "./spotify";

type Music = Settings["music"];

export function CouplingPanel() {
  const music = useSettings().music;
  const playlists = useData((s) => s.data.playlists);
  const trackCount = useData((s) => s.data.tracks.length);
  const spotifyPlaylists = useSpotify((s) => s.playlists);
  const spotifyConnected = useSpotify((s) => s.connected);
  const setSettings = useData((s) => s.setSettings);
  const set = (patch: Partial<Music>) => setSettings((s) => ({ ...s, music: { ...s.music, ...patch } }));

  return (
    <div className="col gap-16" style={{ maxWidth: 760 }}>
      <div className="card">
        <div className="setting">
          <div className="setting-text">
            <span className="strong">Musik mit dem Timer steuern</span>
            <span className="desc">Fokus startet, wechselt und pausiert die Musik passend zu Lern- und Pausenphasen.</span>
          </div>
          <Switch checked={music.couple} onChange={(v) => set({ couple: v })} />
        </div>
        <div className="setting">
          <div className="setting-text">
            <span>Sanft aus- und einblenden</span>
            <span className="desc">Dauer in Sekunden (eigene Musik und Geräusche).</span>
          </div>
          <Stepper value={music.fadeSeconds} min={0} max={10} suffix=" s" onChange={(v) => set({ fadeSeconds: v })} />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>
            <GraduationCap size={16} /> In Lernphasen
          </h3>
        </div>
        <div className="setting">
          <div className="setting-text">
            <span>Musikquelle</span>
          </div>
          <Segmented<Music["focusSource"]>
            value={music.focusSource}
            onChange={(v) => chooseFocusSource(v)}
            options={[
              { value: "none", label: "Keine" },
              { value: "local", label: "Eigene Musik" },
              { value: "spotify", label: "Spotify" },
            ]}
          />
        </div>
        {music.focusSource === "local" && (
          <LocalPlaylistRow
            value={music.localPlaylistId}
            playlists={playlists}
            trackCount={trackCount}
            desc="Beim ersten Start von vorne, danach an der zuletzt gehörten Stelle."
            onChange={chooseLocalFocusMusic}
          />
        )}
        {music.focusSource === "spotify" && (
          <SpotifyPlaylistRow
            value={music.spotifyUri}
            name={music.spotifyName}
            playlists={spotifyPlaylists}
            connected={spotifyConnected}
            desc="Tipp: Mit dem Stern bei einer Spotify-Playlist legst du sie ebenfalls fest."
            onChange={chooseSpotifyFocusMusic}
          />
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>
            <Coffee size={16} /> In Pausen
          </h3>
        </div>
        <div className="setting">
          <div className="setting-text">
            <span>Musik in der Pause</span>
            <span className="desc">
              Mit eigener Pausenmusik geht deine Lernmusik danach genau an der Stelle weiter, an der sie unterbrochen wurde.
            </span>
          </div>
          <Segmented<Music["breakSource"]>
            value={music.breakSource}
            onChange={(v) => chooseBreakSource(v)}
            options={[
              { value: "pause", label: "Pausieren" },
              { value: "continue", label: "Weiterlaufen" },
              { value: "local", label: "Eigene Musik" },
              { value: "spotify", label: "Spotify" },
            ]}
          />
        </div>
        {music.breakSource === "local" && (
          <LocalPlaylistRow
            value={music.breakLocalPlaylistId}
            playlists={playlists}
            trackCount={trackCount}
            desc="Läuft in jeder Pause und stoppt, sobald die nächste Lernphase beginnt."
            onChange={chooseLocalBreakMusic}
          />
        )}
        {music.breakSource === "spotify" && (
          <SpotifyPlaylistRow
            value={music.breakSpotifyUri}
            name={music.breakSpotifyName}
            playlists={spotifyPlaylists}
            connected={spotifyConnected}
            desc="Tipp: Mit dem Tassen-Symbol bei einer Spotify-Playlist legst du sie ebenfalls fest."
            onChange={chooseSpotifyBreakMusic}
            allowResume={false}
          />
        )}
        <p className="tiny faint mt-8">
          Hintergrundgeräusche für Pausen (z. B. Meeresrauschen) stellst du im Reiter „Geräusche“ ein.
        </p>
      </div>
    </div>
  );
}

function LocalPlaylistRow({
  value,
  playlists,
  trackCount,
  desc,
  onChange,
}: {
  value: string | null;
  playlists: LocalPlaylist[];
  trackCount: number;
  desc: string;
  onChange: (id: string | null) => void;
}) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span>Playlist</span>
        <span className="desc">{trackCount ? desc : "Füge zuerst im Reiter „Eigene Musik“ MP3-Dateien hinzu."}</span>
      </div>
      <select className="select" style={{ width: 240 }} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Alle Titel ({trackCount})</option>
        {playlists.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.trackIds.length})
          </option>
        ))}
      </select>
    </div>
  );
}

function SpotifyPlaylistRow({
  value,
  name,
  playlists,
  connected,
  desc,
  onChange,
  allowResume = true,
}: {
  value: string | null;
  name?: string;
  playlists: SpotifyPlaylist[];
  connected: boolean;
  desc: string;
  onChange: (uri: string | null, name?: string) => void;
  allowResume?: boolean;
}) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span>Spotify-Playlist</span>
        <span className="desc">{connected ? desc : "Verbinde zuerst Spotify im Reiter „Spotify“."}</span>
      </div>
      <select
        className="select"
        style={{ width: 240 }}
        value={value ?? ""}
        disabled={!connected}
        onChange={(e) => {
          const p = playlists.find((x) => x.uri === e.target.value);
          onChange(p?.uri ?? null, p?.name);
        }}
      >
        <option value="">{allowResume ? "Zuletzt gespielte fortsetzen" : "Playlist wählen …"}</option>
        {value && !playlists.some((p) => p.uri === value) && <option value={value}>{name ?? value}</option>}
        {playlists.map((p) => (
          <option key={p.id} value={p.uri}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
