import { useState } from "react";
import { FileUp, Link2, RefreshCw, Trash2 } from "lucide-react";
import { Modal, ModuleSelect, Segmented, Switch, confirmDanger, toast } from "../../components/ui";
import { uid } from "../../lib/ids";
import { call, errorText, isTauri } from "../../lib/tauri";
import { addDays, fmtDate, startOfDay, toDateStr } from "../../lib/time";
import { EVENT_TYPES } from "../../store/defaults";
import { useData } from "../../store/data";
import type { EventType, ID, IcalFeed } from "../../store/types";
import { parseIcal } from "./ical";

/** Termine einer Quelle ersetzen (alte Importe derselben Quelle werden entfernt) */
function replaceFeedEvents(feed: string, text: string, type: EventType, moduleId: ID | null, onlyFuture: boolean) {
  const state = useData.getState();
  const { events, modules } = state.data;
  const from = onlyFuture ? startOfDay(new Date()) : new Date(2000, 0, 1);
  const res = parseIcal(text, {
    type,
    moduleId,
    autoModule: moduleId === null,
    modules,
    feed,
    from,
    until: addDays(new Date(), 400),
  });
  const keep = events.filter((e) => e.source?.feed !== feed);
  state.setCollection("events", [...keep, ...res.events]);
  return res;
}

export async function syncFeed(feed: IcalFeed): Promise<number> {
  const text = await call<string>("http_get_text", { url: feed.url });
  const res = replaceFeedEvents(`abo:${feed.id}`, text, feed.type, feed.moduleId, true);
  useData.getState().patch("feeds", feed.id, { lastSync: new Date().toISOString() });
  return res.events.length;
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const feeds = useData((s) => s.data.feeds);
  const upsert = useData((s) => s.upsert);
  const remove = useData((s) => s.remove);
  const [mode, setMode] = useState<"file" | "url">("file");
  const [type, setType] = useState<EventType>("lecture");
  const [moduleId, setModuleId] = useState<ID | null>(null);
  const [onlyFuture, setOnlyFuture] = useState(true);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importFile = async () => {
    setError(null);
    try {
      let text: string;
      let fileName: string;
      if (isTauri) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const path = await open({ multiple: false, filters: [{ name: "Kalender", extensions: ["ics"] }] });
        if (typeof path !== "string") return;
        setBusy(true);
        text = await call<string>("read_text_file", { path });
        fileName = path.split(/[\\/]/).pop() ?? path;
      } else {
        const file = await pickBrowserFile();
        if (!file) return;
        setBusy(true);
        text = await file.text();
        fileName = file.name;
      }
      const res = replaceFeedEvents(`datei:${fileName}`, text, type, moduleId, onlyFuture);
      toast(`${res.events.length} Termine aus „${fileName}“ importiert.`, "success");
      onClose();
    } catch (e) {
      setError(`Import fehlgeschlagen: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const subscribe = async () => {
    setError(null);
    const feed: IcalFeed = { id: uid(), name: name.trim() || "Kalender-Abo", url: url.trim(), type, moduleId };
    setBusy(true);
    try {
      const n = await syncFeed(feed).catch((e) => {
        throw e;
      });
      upsert("feeds", { ...feed, lastSync: new Date().toISOString() });
      toast(`${n} Termine aus „${feed.name}“ übernommen.`, "success");
      setUrl("");
      setName("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (feed: IcalFeed) => {
    setBusy(true);
    setError(null);
    try {
      const n = await syncFeed(feed);
      toast(`„${feed.name}“ aktualisiert: ${n} Termine.`, "success");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async (feed: IcalFeed) => {
    if (!(await confirmDanger("Abo entfernen?", `Alle Termine aus „${feed.name}“ werden aus dem Kalender gelöscht.`, "Entfernen"))) return;
    const { events } = useData.getState().data;
    useData.getState().setCollection(
      "events",
      events.filter((e) => e.source?.feed !== `abo:${feed.id}`),
    );
    remove("feeds", feed.id);
  };

  return (
    <Modal title="Kalender importieren" onClose={onClose} size="wide">
      <div className="col gap-16">
        <p className="muted small">
          Importiere deinen Stundenplan oder andere Kalender im iCal-Format (.ics), z. B. aus dem Vorlesungsverzeichnis der Uni, aus
          Outlook oder aus Google Kalender. Wiederkehrende Termine werden automatisch übernommen, Module werden anhand des Titels erkannt.
        </p>
        <Segmented<"file" | "url">
          value={mode}
          onChange={setMode}
          options={[
            { value: "file", label: "Datei (.ics)" },
            { value: "url", label: "Abo über Adresse" },
          ]}
        />
        <div className="form-grid">
          <div className="field">
            <span className="field-label">Standard-Termintyp</span>
            <select className="select" value={type} onChange={(e) => setType(e.target.value as EventType)}>
              {(Object.keys(EVENT_TYPES) as EventType[]).map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPES[t].label}
                </option>
              ))}
            </select>
            <span className="help">„Übung“, „Klausur“ usw. im Titel werden automatisch erkannt.</span>
          </div>
          <div className="field">
            <span className="field-label">Modul</span>
            <ModuleSelect value={moduleId} onChange={setModuleId} noneLabel="Automatisch anhand des Titels" />
          </div>
        </div>

        {mode === "file" ? (
          <div className="col gap-12">
            <Switch checked={onlyFuture} onChange={setOnlyFuture} label="Nur Termine ab heute übernehmen" />
            <div>
              <button className="btn primary" onClick={() => void importFile()} disabled={busy}>
                <FileUp size={15} /> Datei auswählen und importieren
              </button>
            </div>
            <p className="tiny faint">Importierst du dieselbe Datei erneut, werden die zuvor daraus importierten Termine ersetzt.</p>
          </div>
        ) : (
          <div className="col gap-12">
            <div className="form-grid">
              <div className="field span-2">
                <label>Kalender-Adresse (https:// oder webcal://)</label>
                <input className="input" value={url} placeholder="https://…/kalender.ics" onChange={(e) => setUrl(e.target.value)} />
              </div>
              <div className="field">
                <label>Name</label>
                <input className="input" value={name} placeholder="z. B. Stundenplan WiSe" onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field" style={{ justifyContent: "flex-end" }}>
                <button className="btn primary" onClick={() => void subscribe()} disabled={busy || !url.trim() || !isTauri}>
                  <Link2 size={15} /> Abonnieren
                </button>
              </div>
            </div>
            {feeds.length > 0 && (
              <div className="list">
                {feeds.map((f) => (
                  <div key={f.id} className="list-item">
                    <Link2 size={15} className="faint" />
                    <div className="grow col" style={{ gap: 0 }}>
                      <span className="small strong">{f.name}</span>
                      <span className="tiny faint ellipsis">
                        {f.lastSync ? `zuletzt aktualisiert: ${fmtDate(toDateStr(new Date(f.lastSync)), { day: "numeric", month: "short" })}` : "noch nicht geladen"}
                      </span>
                    </div>
                    <button className="btn sm" onClick={() => void refresh(f)} disabled={busy}>
                      <RefreshCw size={14} /> Aktualisieren
                    </button>
                    <button className="icon-btn sm" onClick={() => void unsubscribe(f)} title="Abo entfernen">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="tiny faint">Abos werden beim Start der App automatisch aktualisiert (höchstens einmal täglich).</p>
          </div>
        )}
        {error && <div className="banner danger">{error}</div>}
      </div>
    </Modal>
  );
}

function pickBrowserFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ics,text/calendar";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Beim Start: Abos aktualisieren, die älter als 20 Stunden sind */
export async function autoSyncFeeds() {
  if (!isTauri) return;
  const feeds = useData.getState().data.feeds;
  for (const f of feeds) {
    const age = f.lastSync ? Date.now() - new Date(f.lastSync).getTime() : Infinity;
    if (age > 20 * 3600_000) await syncFeed(f).catch(() => {});
  }
}
