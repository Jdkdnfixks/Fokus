import { useEffect, useState } from "react";
import { Music2, SlidersHorizontal, Volume2, Waves } from "lucide-react";
import { useNav } from "../../store/nav";
import { AmbientPanel } from "./AmbientPanel";
import { CouplingPanel } from "./CouplingPanel";
import { LocalMusic } from "./LocalMusic";
import { SpotifyPanel } from "./SpotifyPanel";
import { VolumePanel } from "./VolumePanel";

type Tab = "local" | "spotify" | "ambient" | "volume" | "coupling";

function SpotifyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M7.5 9.5c3-1 6.5-.7 9 .8M8 12.6c2.5-.7 5.3-.4 7.4.8M8.7 15.5c2-.5 4-.3 5.6.6" />
    </svg>
  );
}

export function MusicPage() {
  const focusId = useNav((s) => s.focusId);
  const [tab, setTab] = useState<Tab>(focusId === "ambient" ? "ambient" : "local");

  useEffect(() => {
    if (focusId === "ambient") setTab("ambient");
  }, [focusId]);

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h1>Musik</h1>
          <p className="subtitle">Deine Lernmusik, Spotify und ruhige Hintergrundgeräusche</p>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === "local" ? "active" : ""} onClick={() => setTab("local")}>
          <Music2 size={15} /> Eigene Musik
        </button>
        <button className={tab === "spotify" ? "active" : ""} onClick={() => setTab("spotify")}>
          <SpotifyIcon size={15} /> Spotify
        </button>
        <button className={tab === "ambient" ? "active" : ""} onClick={() => setTab("ambient")}>
          <Waves size={15} /> Geräusche
        </button>
        <button className={tab === "volume" ? "active" : ""} onClick={() => setTab("volume")}>
          <Volume2 size={15} /> Lautstärke
        </button>
        <button className={tab === "coupling" ? "active" : ""} onClick={() => setTab("coupling")}>
          <SlidersHorizontal size={15} /> Timer-Kopplung
        </button>
      </div>
      {tab === "local" && <LocalMusic />}
      {tab === "spotify" && <SpotifyPanel />}
      {tab === "ambient" && <AmbientPanel />}
      {tab === "volume" && <VolumePanel />}
      {tab === "coupling" && <CouplingPanel />}
    </div>
  );
}
