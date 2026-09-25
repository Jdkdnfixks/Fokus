import { Segmented, Stepper, Switch } from "../../components/ui";
import { useData, useSettings } from "../../store/data";
import type { Settings } from "../../store/types";
import { useSpotify } from "./spotify";

export function CouplingPanel() {
  const music = useSettings().music;
  const playlists = useData((s) => s.data.playlists);
  const spotifyPlaylists = useSpotify((s) => s.playlists);
  const spotifyConnected = useSpotify((s) => s.connected);
  const setSettings = useData((s) => s.setSettings);
  const set = (patch: Partial<Settings["music"]>) => setSettings((s) => ({ ...s, music: { ...s.music, ...patch } }));

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="setting">
        <div className="setting-text">
          <span className="strong">Musik mit dem Timer steuern</span>
          <span className="desc">Startet die Lernmusik mit jeder Lernphase und pausiert sie in den Pausen.</span>
        </div>
        <Switch checked={music.couple} onChange={(v) => set({ couple: v })} />
      </div>

      <div className="setting">
        <div className="setting-text">
          <span>Musikquelle in Lernphasen</span>
        </div>
        <Segmented<Settings["music"]["focusSource"]>
          value={music.focusSource}
          onChange={(v) => set({ focusSource: v })}
          options={[
            { value: "none", label: "Keine" },
            { value: "local", label: "Eigene Musik" },
            { value: "spotify", label: "Spotify" },
          ]}
        />
      </div>

      {music.focusSource === "local" && (
        <div className="setting">
          <div className="setting-text">
            <span>Playlist</span>
            <span className="desc">Wird beim ersten Start abgespielt und danach fortgesetzt.</span>
          </div>
          <select
            className="select"
            style={{ width: 240 }}
            value={music.localPlaylistId ?? ""}
            onChange={(e) => set({ localPlaylistId: e.target.value || null })}
          >
            <option value="">Alle Titel</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {music.focusSource === "spotify" && (
        <div className="setting">
          <div className="setting-text">
            <span>Spotify-Playlist</span>
            <span className="desc">
              {spotifyConnected
                ? "Tipp: Mit dem Stern bei einer Playlist legst du sie ebenfalls fest."
                : "Verbinde zuerst Spotify im Reiter „Spotify“."}
            </span>
          </div>
          <select
            className="select"
            style={{ width: 240 }}
            value={music.spotifyUri ?? ""}
            disabled={!spotifyConnected}
            onChange={(e) => {
              const p = spotifyPlaylists.find((x) => x.uri === e.target.value);
              set({ spotifyUri: p?.uri ?? null, spotifyName: p?.name });
            }}
          >
            <option value="">Zuletzt gespielte fortsetzen</option>
            {music.spotifyUri && !spotifyPlaylists.some((p) => p.uri === music.spotifyUri) && (
              <option value={music.spotifyUri}>{music.spotifyName ?? music.spotifyUri}</option>
            )}
            {spotifyPlaylists.map((p) => (
              <option key={p.id} value={p.uri}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="setting">
        <div className="setting-text">
          <span>In Pausen</span>
        </div>
        <Segmented<Settings["music"]["breakBehavior"]>
          value={music.breakBehavior}
          onChange={(v) => set({ breakBehavior: v })}
          options={[
            { value: "pause", label: "Musik pausieren" },
            { value: "continue", label: "Weiterlaufen lassen" },
          ]}
        />
      </div>

      <div className="setting">
        <div className="setting-text">
          <span>Sanft aus- und einblenden</span>
          <span className="desc">Dauer in Sekunden (gilt für eigene Musik und Geräusche).</span>
        </div>
        <Stepper value={music.fadeSeconds} min={0} max={10} suffix=" s" onChange={(v) => set({ fadeSeconds: v })} />
      </div>
    </div>
  );
}
