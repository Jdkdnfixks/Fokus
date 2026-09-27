import { ArrowLeftRight, Volume1, Volume2 } from "lucide-react";
import { Segmented, Slider, Stepper, Switch, toast } from "../../components/ui";
import { useData, useSettings } from "../../store/data";
import type { Settings } from "../../store/types";
import { useLocalPlayer } from "./localPlayer";
import { retryLoudnessScan, useLoudnessScan } from "./loudnessScan";
import { spotifyPause, spotifyPlayFadeIn, useSpotify } from "./spotify";
import { formatOffset } from "./volume";
import { setMusicVolume, setVolumeOption } from "./volumeControl";

type Music = Settings["music"];

export function VolumePanel() {
  const music = useSettings().music;
  const spotifyConnected = useSpotify((s) => s.connected);

  return (
    <div className="col gap-16" style={{ maxWidth: 760 }}>
      <div className="card">
        <div className="card-header">
          <h3>
            <Volume2 size={16} /> Musiklautstärke
          </h3>
        </div>
        <div className="row gap-12 volume-main">
          <Volume1 size={16} className="faint" />
          <Slider value={music.volume} onChange={setMusicVolume} ariaLabel="Musiklautstärke" />
          <span className="tabular strong volume-value">{Math.round(music.volume * 100)} %</span>
        </div>
        <div className="setting">
          <div className="setting-text">
            <span>Spotify mit demselben Regler steuern</span>
            <span className="desc">
              Ein Regler für eigene Musik und Spotify. Änderst du die Lautstärke direkt in Spotify, übernimmt Fokus sie für
              beide.
            </span>
          </div>
          <Switch checked={music.linkVolume} onChange={(v) => setVolumeOption({ linkVolume: v })} />
        </div>
      </div>

      <div className="card">
        <div className="setting">
          <div className="setting-text">
            <span className="strong">Eigene Musik gleich laut abspielen</span>
            <span className="desc">
              Fokus misst jede Datei einmal und gleicht laute und leise Titel aus – auf denselben Pegel wie Spotify. Deine Dateien
              bleiben dabei unverändert.
            </span>
          </div>
          <Switch checked={music.normalize} onChange={(v) => setVolumeOption({ normalize: v })} />
        </div>
        {music.normalize && <MeasureStatus />}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>An Spotify angleichen</h3>
        </div>
        <div className="setting">
          <div className="setting-text">
            <span>Lautstärkepegel in Spotify</span>
            <span className="desc">
              Wähle dasselbe wie in den Spotify-Einstellungen unter „Lautstärkepegel“. Dort sollte auch „Lautstärke normalisieren“
              eingeschaltet sein (Standard).
            </span>
          </div>
          <Segmented<Music["loudnessTarget"]>
            value={music.loudnessTarget}
            onChange={(v) => setVolumeOption({ loudnessTarget: v })}
            options={[
              { value: "quiet", label: "Leise" },
              { value: "normal", label: "Normal" },
              { value: "loud", label: "Laut" },
            ]}
          />
        </div>
        <div className="setting">
          <div className="setting-text">
            <span>Feinabgleich für Spotify</span>
            <span className="desc">
              Klingt Spotify noch lauter als deine eigene Musik, stell einen Minuswert ein. Klingt es leiser, einen Pluswert.
            </span>
          </div>
          <Stepper
            value={music.spotifyOffsetDb}
            min={-12}
            max={12}
            onChange={(v) => setVolumeOption({ spotifyOffsetDb: v })}
            display={formatOffset}
          />
        </div>
        {spotifyConnected && <CompareRow />}
      </div>
    </div>
  );
}

function MeasureStatus() {
  const tracks = useData((s) => s.data.tracks);
  const currentId = useLoudnessScan((s) => s.currentId);
  if (!tracks.length) return <p className="small muted mt-8">Sobald du eigene Musik hinzufügst, wird sie automatisch gemessen.</p>;

  const measured = tracks.filter((t) => typeof t.loudness === "number").length;
  const unsupported = tracks.filter((t) => t.loudness === null).length;
  const pending = tracks.length - measured - unsupported;
  const current = tracks.find((t) => t.id === currentId);

  return (
    <div className="measure-status small">
      {pending === 0 ? (
        <span className="muted">{measured === 1 ? "Der Titel ist gemessen und angeglichen." : `Alle ${measured} Titel sind gemessen und angeglichen.`}</span>
      ) : (
        <span className="muted">
          {measured} von {tracks.length} Titeln gemessen
          {current ? (
            <>
              {" "}
              · misst gerade „{current.title}“ …
            </>
          ) : (
            <>
              {" "}
              ·{" "}
              <button className="link-btn" onClick={retryLoudnessScan}>
                erneut versuchen
              </button>
            </>
          )}
        </span>
      )}
      {unsupported > 0 && (
        <span className="faint">
          {unsupported} {unsupported === 1 ? "Titel lässt" : "Titel lassen"} sich nicht messen (Format wird nicht unterstützt) und{" "}
          {unsupported === 1 ? "läuft" : "laufen"} in Originallautstärke.
        </span>
      )}
    </div>
  );
}

/** Zwischen Spotify und eigener Musik hin- und herschalten, um den Feinabgleich zu finden. */
function CompareRow() {
  const localQueue = useLocalPlayer((s) => s.queue.length);
  const localPlaying = useLocalPlayer((s) => s.playing);
  const playback = useSpotify((s) => s.playback);
  const ready = localQueue > 0 && !!playback?.trackUri;

  const toggle = async () => {
    const local = useLocalPlayer.getState();
    if (local.playing) {
      local.pause();
      await spotifyPlayFadeIn(null, 0);
    } else {
      if (useSpotify.getState().playback?.isPlaying) await spotifyPause();
      local.resume();
    }
    const err = useSpotify.getState().error;
    if (err) toast(err, "error");
  };

  const now = localPlaying ? "eigene Musik" : playback?.isPlaying ? "Spotify" : null;

  return (
    <div className="setting">
      <div className="setting-text">
        <span>Vergleichen</span>
        <span className="desc">
          {ready
            ? `Schaltet zwischen Spotify und deiner Musik hin und her – so hörst du, ob beide gleich laut sind.${now ? ` Gerade läuft: ${now}.` : ""}`
            : "Spiel dafür zuerst einmal einen Titel unter „Eigene Musik“ und eine Playlist unter „Spotify“ an."}
        </span>
      </div>
      <button className="btn" onClick={() => void toggle()} disabled={!ready}>
        <ArrowLeftRight size={14} /> Umschalten
      </button>
    </div>
  );
}
