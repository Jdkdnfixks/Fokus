import { useEffect, useMemo, useState } from "react";
import {
  Coffee,
  FolderPlus,
  ListMusic,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  Timer,
  SkipForward,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { Empty, Slider, confirmDanger, toast } from "../../components/ui";
import { uid } from "../../lib/ids";
import { call, errorText, isTauri } from "../../lib/tauri";
import { useData, useSettings } from "../../store/data";
import type { ID, LocalTrack } from "../../store/types";
import { chooseBreakSource, chooseFocusSource, chooseLocalBreakMusic, chooseLocalFocusMusic, ensureFocusMusicDefault } from "./focusMusic";
import { applyLocalVolume, currentLocalTrack, playlistTrackIds, stopIfTrackRemoved, useLocalPlayer } from "./localPlayer";

interface ImportedTrack {
  id: string;
  file: string;
  original: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
}

const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "webm"];

export function fmtSeconds(s?: number) {
  if (s === undefined || !isFinite(s) || s < 0) return "–";
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

async function importPaths(paths: string[], playlistId: ID | null) {
  const audio = paths.filter((p) => AUDIO_EXT.includes(p.split(".").pop()?.toLowerCase() ?? ""));
  if (!audio.length) {
    toast("Keine unterstützten Audiodateien gefunden (MP3, M4A, WAV, OGG, FLAC).", "error");
    return;
  }
  try {
    const imported = await call<ImportedTrack[]>("music_import", { paths: audio });
    const now = new Date().toISOString();
    const tracks: LocalTrack[] = imported.map((t) => ({
      id: t.id,
      file: t.file,
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
      addedAt: now,
    }));
    const store = useData.getState();
    store.upsertMany("tracks", tracks);
    if (playlistId) {
      const pl = store.data.playlists.find((p) => p.id === playlistId);
      if (pl) store.patch("playlists", pl.id, { trackIds: [...pl.trackIds, ...tracks.map((t) => t.id)] });
    }
    toast(`${tracks.length} Titel hinzugefügt.`, "success");
    if (ensureFocusMusicDefault()) {
      toast("Deine Musik startet ab jetzt automatisch, sobald du den Timer startest.", "success", 6000);
    }
  } catch (e) {
    toast(`Import fehlgeschlagen: ${errorText(e)}`, "error");
  }
}

export function LocalMusic() {
  const tracks = useData((s) => s.data.tracks);
  const playlists = useData((s) => s.data.playlists);
  const upsert = useData((s) => s.upsert);
  const patch = useData((s) => s.patch);
  const remove = useData((s) => s.remove);
  const [selected, setSelected] = useState<ID | null>(null);
  const [newName, setNewName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const player = useLocalPlayer();
  const current = player.queue[player.index];
  const music = useSettings().music;
  const isFocusMusic = music.couple && music.focusSource === "local" && music.localPlaylistId === selected;
  const isBreakMusic = music.couple && music.breakSource === "local" && music.breakLocalPlaylistId === selected;

  const playlist = playlists.find((p) => p.id === selected) ?? null;
  const ids = useMemo(() => (playlist ? playlistTrackIds(playlist.id) : tracks.map((t) => t.id)), [playlist, tracks]);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const list = ids.map((id) => byId.get(id)).filter(Boolean) as LocalTrack[];

  // Dateien per Drag & Drop ins Fenster ziehen
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((e) => {
          if (e.payload.type === "over" || e.payload.type === "enter") setDragOver(true);
          else if (e.payload.type === "leave") setDragOver(false);
          else if (e.payload.type === "drop") {
            setDragOver(false);
            void importPaths(e.payload.paths, selected);
          }
        })
        .then((fn) => (unlisten = fn)),
    );
    return () => unlisten?.();
  }, [selected]);

  const addFiles = async () => {
    if (!isTauri) {
      toast("Musik importieren geht nur in der Desktop-App.", "error");
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ multiple: true, filters: [{ name: "Audio", extensions: AUDIO_EXT }] });
    const paths = Array.isArray(res) ? res : typeof res === "string" ? [res] : [];
    if (paths.length) await importPaths(paths, selected);
  };

  const createPlaylist = () => {
    const name = newName.trim();
    if (!name) return;
    const id = uid();
    upsert("playlists", { id, name, trackIds: [] });
    setNewName("");
    setSelected(id);
  };

  const deleteTrack = async (t: LocalTrack) => {
    if (!(await confirmDanger("Titel löschen?", `„${t.title}“ wird aus Fokus und aus dem Musikordner gelöscht.`))) return;
    try {
      await call("music_delete", { file: t.file });
    } catch {
      /* Datei fehlt bereits */
    }
    stopIfTrackRemoved(t.id);
    remove("tracks", t.id);
    for (const pl of useData.getState().data.playlists) {
      if (pl.trackIds.includes(t.id)) patch("playlists", pl.id, { trackIds: pl.trackIds.filter((x) => x !== t.id) });
    }
  };

  const deletePlaylist = async () => {
    if (!playlist) return;
    if (!(await confirmDanger("Playlist löschen?", `„${playlist.name}“ wird gelöscht. Die Titel bleiben erhalten.`))) return;
    remove("playlists", playlist.id);
    setSelected(null);
  };

  return (
    <div className="music-layout">
      <aside className="card tight playlist-list">
        <button className={`list-item pl-item ${selected === null ? "selected" : ""}`} onClick={() => setSelected(null)}>
          <Music2 size={16} />
          <span className="grow ellipsis">Alle Titel</span>
          <span className="tiny faint">{tracks.length}</span>
        </button>
        {playlists.map((p) => (
          <button key={p.id} className={`list-item pl-item ${selected === p.id ? "selected" : ""}`} onClick={() => setSelected(p.id)}>
            <ListMusic size={16} />
            <span className="grow ellipsis">{p.name}</span>
            <span className="tiny faint">{p.trackIds.length}</span>
          </button>
        ))}
        <div className="quick-add compact">
          <Plus size={15} className="faint" />
          <input
            className="input bare grow sm"
            placeholder="Neue Playlist …"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createPlaylist()}
          />
        </div>
      </aside>

      <section className="card col gap-12" style={{ minWidth: 0 }}>
        <div className="row between wrap">
          <div className="row gap-12">
            <button
              className="play-circle"
              disabled={!list.length}
              onClick={() => {
                if (player.playing && player.playlistId === selected) player.pause();
                else player.playQueue(list.map((t) => t.id), 0, selected);
              }}
              title="Abspielen"
            >
              {player.playing && player.playlistId === selected ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
            </button>
            <div className="col" style={{ gap: 0 }}>
              <h2>{playlist ? playlist.name : "Alle Titel"}</h2>
              <span className="tiny faint">
                {list.length} Titel · {fmtSeconds(list.reduce((a, t) => a + (t.duration ?? 0), 0))}
              </span>
            </div>
          </div>
          <div className="row gap-4">
            {list.length > 0 && (
              <button
                className={`btn ${isFocusMusic ? "soft" : ""}`}
                onClick={() => (isFocusMusic ? chooseFocusSource("none") : chooseLocalFocusMusic(selected))}
                title={isFocusMusic ? "Startet automatisch mit dem Timer – klicken zum Ausschalten" : "Mit dem Timer automatisch abspielen"}
              >
                <Timer size={15} /> {isFocusMusic ? "Lernmusik ✓" : "Als Lernmusik"}
              </button>
            )}
            {list.length > 0 && (
              <button
                className={`btn ${isBreakMusic ? "soft" : ""}`}
                onClick={() => (isBreakMusic ? chooseBreakSource("pause") : chooseLocalBreakMusic(selected))}
                title={isBreakMusic ? "Läuft in den Pausen – klicken zum Ausschalten" : "In den Pausen abspielen"}
              >
                <Coffee size={15} /> {isBreakMusic ? "Pausenmusik ✓" : "Als Pausenmusik"}
              </button>
            )}
            <button className="btn" onClick={() => void addFiles()}>
              <FolderPlus size={15} /> Dateien hinzufügen
            </button>
            {playlist && (
              <button className="icon-btn" onClick={() => void deletePlaylist()} title="Playlist löschen">
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>

        {(isFocusMusic || isBreakMusic) && (
          <div className="banner info">
            {isFocusMusic ? <Timer size={15} /> : <Coffee size={15} />}
            <span>
              {playlist ? `„${playlist.name}“` : "Diese Titel"}{" "}
              {isFocusMusic && isBreakMusic
                ? "laufen in Lern- und Pausenphasen."
                : isFocusMusic
                  ? "starten automatisch mit jeder Lernphase. Nach einer Pause geht es an derselben Stelle weiter."
                  : "laufen in deinen Pausen. Danach geht deine Lernmusik an der alten Stelle weiter."}
            </span>
          </div>
        )}

        <div className={`drop-zone ${dragOver ? "over" : ""}`}>
          {dragOver ? "Loslassen zum Hinzufügen" : "MP3-Dateien einfach hierher ins Fenster ziehen"}
        </div>

        {list.length ? (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Titel</th>
                <th>Interpret</th>
                <th style={{ width: 60 }}>Dauer</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {list.map((t, i) => (
                <tr
                  key={t.id}
                  className={`clickable ${t.id === current ? "playing" : ""}`}
                  onDoubleClick={() => player.playQueue(list.map((x) => x.id), i, selected)}
                >
                  <td className="faint tabular">
                    {t.id === current && player.playing ? <Volume2 size={14} /> : i + 1}
                  </td>
                  <td className="ellipsis" style={{ maxWidth: 260 }}>
                    {t.title}
                  </td>
                  <td className="muted ellipsis" style={{ maxWidth: 180 }}>
                    {t.artist ?? "–"}
                  </td>
                  <td className="muted tabular">{fmtSeconds(t.duration)}</td>
                  <td>
                    <div className="row gap-4" style={{ justifyContent: "flex-end" }}>
                      <button className="icon-btn sm" onClick={() => player.playQueue(list.map((x) => x.id), i, selected)} title="Abspielen">
                        <Play size={14} />
                      </button>
                      {playlist ? (
                        <button
                          className="icon-btn sm"
                          title="Aus Playlist entfernen"
                          onClick={() => patch("playlists", playlist.id, { trackIds: playlist.trackIds.filter((x) => x !== t.id) })}
                        >
                          <X size={14} />
                        </button>
                      ) : (
                        playlists.length > 0 && (
                          <select
                            className="select sm"
                            style={{ width: 110 }}
                            value=""
                            onChange={(e) => {
                              const pl = playlists.find((p) => p.id === e.target.value);
                              if (pl && !pl.trackIds.includes(t.id)) patch("playlists", pl.id, { trackIds: [...pl.trackIds, t.id] });
                              if (pl) toast(`Zu „${pl.name}“ hinzugefügt.`, "success", 2000);
                            }}
                          >
                            <option value="">+ Playlist</option>
                            {playlists.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        )
                      )}
                      {!playlist && (
                        <button className="icon-btn sm" onClick={() => void deleteTrack(t)} title="Löschen">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            icon={<Music2 size={20} />}
            title={playlist ? "Diese Playlist ist leer" : "Noch keine Musik"}
            text={
              playlist
                ? "Füge Titel über „Alle Titel“ hinzu oder ziehe Dateien hierher."
                : "Füge MP3-Dateien hinzu. Sie werden in deinen Datenordner kopiert und sind so auch auf dem Laptop verfügbar."
            }
          />
        )}
      </section>

      <LocalPlayerBar />
    </div>
  );
}

function LocalPlayerBar() {
  const player = useLocalPlayer();
  const volume = useSettings().music.localVolume;
  const setSettings = useData((s) => s.setSettings);
  const track = currentLocalTrack();
  if (!player.queue.length) return null;

  const RepeatIcon = player.repeat === "one" ? Repeat1 : Repeat;
  const nextRepeat = player.repeat === "off" ? "all" : player.repeat === "all" ? "one" : "off";

  return (
    <div className="card tight player-bar">
      <div className="col" style={{ gap: 0, minWidth: 0 }}>
        <span className="small strong ellipsis">{track?.title ?? "–"}</span>
        <span className="tiny faint ellipsis">{track?.artist ?? ""}</span>
      </div>
      <div className="col" style={{ alignItems: "center", gap: 2 }}>
        <div className="row gap-4">
          <button className={`icon-btn sm ${player.shuffle ? "active" : ""}`} onClick={() => player.setShuffle(!player.shuffle)} title="Zufällig">
            <Shuffle size={14} />
          </button>
          <button className="icon-btn" onClick={player.prev} title="Zurück">
            <SkipBack size={16} />
          </button>
          <button className="play-circle sm" onClick={player.toggle} title={player.playing ? "Pause" : "Abspielen"}>
            {player.playing ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
          </button>
          <button className="icon-btn" onClick={player.next} title="Weiter">
            <SkipForward size={16} />
          </button>
          <button
            className={`icon-btn sm ${player.repeat !== "off" ? "active" : ""}`}
            onClick={() => player.setRepeat(nextRepeat)}
            title="Wiederholen"
          >
            <RepeatIcon size={14} />
          </button>
        </div>
        <div className="row gap-8" style={{ width: "100%", maxWidth: 420 }}>
          <span className="tiny faint tabular">{fmtSeconds(player.position)}</span>
          <Slider value={player.position} max={player.duration || 1} step={1} onChange={player.seek} ariaLabel="Position" />
          <span className="tiny faint tabular">{fmtSeconds(player.duration)}</span>
        </div>
      </div>
      <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
        <Volume2 size={15} className="faint" />
        <div style={{ width: 110 }}>
          <Slider
            value={volume}
            onChange={(v) => {
              setSettings((s) => ({ ...s, music: { ...s.music, localVolume: v } }));
              setTimeout(applyLocalVolume, 0);
            }}
            ariaLabel="Lautstärke"
          />
        </div>
      </div>
      {player.error && <span className="tiny" style={{ color: "var(--danger)", gridColumn: "1 / -1" }}>{player.error}</span>}
    </div>
  );
}
