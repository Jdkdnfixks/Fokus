import { Music2, Pause, Play, SkipForward, Waves } from "lucide-react";
import { useNav } from "../../store/nav";
import { ambientToggle, useAmbient } from "./ambient";
import { currentLocalTrack, useLocalPlayer } from "./localPlayer";
import { spotifyNext, spotifyPause, spotifyPlay, useSpotify } from "./spotify";

/** Kleine Wiedergabe-Anzeige in der Seitenleiste */
export function NowPlaying() {
  const local = useLocalPlayer();
  const spotify = useSpotify((s) => s.playback);
  const spotifyConnected = useSpotify((s) => s.connected);
  const ambient = useAmbient((s) => s.playing);
  const navigate = useNav((s) => s.navigate);

  const showLocal = local.queue.length > 0 && (local.playing || !spotify?.isPlaying);
  const showSpotify = !showLocal && spotifyConnected && spotify?.track;

  if (!showLocal && !showSpotify && !ambient) return null;

  const track = showLocal ? currentLocalTrack() : null;

  return (
    <div className="side-widget">
      {(showLocal || showSpotify) && (
        <div className="now-playing">
          {showSpotify && spotify?.image ? (
            <img className="cover" src={spotify.image} alt="" />
          ) : (
            <span className="cover">
              <Music2 size={15} />
            </span>
          )}
          <div className="col grow" style={{ gap: 0, minWidth: 0, cursor: "pointer" }} onClick={() => navigate("music")}>
            <span className="small ellipsis">{showLocal ? track?.title : spotify?.track}</span>
            <span className="tiny faint ellipsis">{showLocal ? track?.artist ?? "Eigene Musik" : spotify?.artists}</span>
          </div>
          <button
            className="icon-btn sm"
            onClick={() => {
              if (showLocal) local.toggle();
              else void (spotify?.isPlaying ? spotifyPause() : spotifyPlay(null));
            }}
          >
            {(showLocal ? local.playing : spotify?.isPlaying) ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button className="icon-btn sm" onClick={() => (showLocal ? local.next() : void spotifyNext())}>
            <SkipForward size={14} />
          </button>
        </div>
      )}
      {ambient && (
        <div className="row between tiny muted">
          <span className="row gap-4">
            <Waves size={13} /> Geräusche laufen
          </span>
          <button className="link-btn tiny" onClick={() => ambientToggle()}>
            Aus
          </button>
        </div>
      )}
    </div>
  );
}
