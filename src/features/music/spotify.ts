import { create } from "zustand";
import { call, errorText, isTauri, openExternal } from "../../lib/tauri";
import { useData } from "../../store/data";

/**
 * Spotify-Anbindung über die Web API. Fokus steuert die Spotify-App auf dem
 * PC fern (Spotify Connect). Voraussetzung: Spotify Premium und eine eigene
 * App im Spotify Developer Dashboard (Client-ID).
 */

export const SPOTIFY_PORT = 43821;
export const SPOTIFY_REDIRECT = `http://127.0.0.1:${SPOTIFY_PORT}/callback`;
export const SPOTIFY_DASHBOARD = "https://developer.spotify.com/dashboard";
const SCOPES = [
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");
const TOKEN_KEY = "fokus-spotify-token";
const API = "https://api.spotify.com/v1";

interface TokenSet {
  access: string;
  refresh: string;
  expiresAt: number;
  clientId: string;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volume: number | null;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
  image?: string;
  owner?: string;
  total?: number;
}

export interface SpotifyPlayback {
  isPlaying: boolean;
  track?: string;
  trackUri?: string;
  artists?: string;
  image?: string;
  contextUri?: string | null;
  progressMs: number;
  durationMs: number;
  deviceId?: string;
  deviceName?: string;
  volume?: number | null;
  shuffle: boolean;
  fetchedAt: number;
}

interface SpotifyState {
  connected: boolean;
  connecting: boolean;
  profile: { name: string; product?: string } | null;
  devices: SpotifyDevice[];
  preferredDevice: string | null;
  playlists: SpotifyPlaylist[];
  playback: SpotifyPlayback | null;
  status: string | null;
  error: string | null;
}

export const useSpotify = create<SpotifyState>()(() => ({
  connected: !!loadToken(),
  connecting: false,
  profile: null,
  devices: [],
  preferredDevice: localStorage.getItem("fokus-spotify-device"),
  playlists: [],
  playback: null,
  status: null,
  error: null,
}));

class SpotifyError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
  ) {
    super(message);
  }
}

function loadToken(): TokenSet | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  } catch {
    return null;
  }
}

function saveToken(t: TokenSet | null) {
  if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
  else localStorage.removeItem(TOKEN_KEY);
}

function base64Url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return base64Url(bytes).slice(0, len);
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const raw = await call<string>("spotify_token", { params });
  const json = JSON.parse(raw) as { access_token: string; refresh_token?: string; expires_in: number };
  const prev = loadToken();
  const token: TokenSet = {
    access: json.access_token,
    refresh: json.refresh_token ?? prev?.refresh ?? "",
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    clientId: params.client_id,
  };
  saveToken(token);
  return token;
}

let refreshing: Promise<TokenSet> | null = null;

async function validToken(): Promise<string> {
  const t = loadToken();
  if (!t) throw new SpotifyError(401, "Nicht mit Spotify verbunden.");
  if (Date.now() < t.expiresAt) return t.access;
  if (!refreshing) {
    refreshing = tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: t.clientId }).finally(
      () => (refreshing = null),
    );
  }
  try {
    return (await refreshing).access;
  } catch (e) {
    saveToken(null);
    useSpotify.setState({ connected: false, profile: null });
    throw new SpotifyError(401, `Spotify-Verbindung abgelaufen. Bitte neu verbinden. (${errorText(e)})`);
  }
}

async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T | null> {
  const token = await validToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 401 && retry) {
    const t = loadToken();
    if (t) saveToken({ ...t, expiresAt: 0 });
    return api<T>(path, init, false);
  }
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  if (!res.ok) {
    let message = `Spotify-Fehler ${res.status}`;
    let reason: string | undefined;
    try {
      const body = JSON.parse(text);
      message = body?.error?.message ?? message;
      reason = body?.error?.reason;
    } catch {
      /* kein JSON */
    }
    throw new SpotifyError(res.status, message, reason);
  }
  return text ? (JSON.parse(text) as T) : null;
}

function friendlyError(e: unknown): string {
  if (e instanceof SpotifyError) {
    if (e.reason === "NO_ACTIVE_DEVICE" || e.status === 404)
      return "Kein aktives Spotify-Gerät gefunden. Öffne Spotify auf diesem PC und versuche es erneut.";
    if (e.reason === "PREMIUM_REQUIRED") return "Für die Steuerung ist Spotify Premium nötig.";
    if (e.status === 403) return `Spotify erlaubt diese Aktion nicht (${e.message}).`;
    if (e.status === 429) return "Spotify bremst gerade die Anfragen. Bitte kurz warten.";
    return e.message;
  }
  return errorText(e);
}

function setError(e: unknown) {
  useSpotify.setState({ error: friendlyError(e), status: null });
}

/* ---------------- Anmeldung ---------------- */

export async function connectSpotify() {
  const clientId = useData.getState().data.settings.spotify.clientId.trim();
  if (!clientId) {
    useSpotify.setState({ error: "Bitte zuerst die Client-ID eintragen." });
    return;
  }
  if (!isTauri) {
    useSpotify.setState({ error: "Die Spotify-Anmeldung funktioniert nur in der Desktop-App." });
    return;
  }
  useSpotify.setState({ connecting: true, error: null, status: "Browser geöffnet – bitte bei Spotify anmelden …" });
  try {
    const verifier = randomString(64);
    const state = randomString(16);
    const challenge = await challengeFor(verifier);
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: SPOTIFY_REDIRECT,
      code_challenge_method: "S256",
      code_challenge: challenge,
      state,
    }).toString();
    const code = await call<string>("spotify_authorize", { authUrl: url.toString(), port: SPOTIFY_PORT, state });
    await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    });
    useSpotify.setState({ connected: true, connecting: false, status: null });
    await initSpotify();
  } catch (e) {
    useSpotify.setState({ connecting: false, status: null, error: friendlyError(e) });
  }
}

export function disconnectSpotify() {
  saveToken(null);
  useSpotify.setState({ connected: false, profile: null, devices: [], playlists: [], playback: null, error: null });
}

/* ---------------- Daten laden ---------------- */

export async function initSpotify() {
  if (!loadToken()) return;
  try {
    const me = await api<{ display_name: string; product?: string }>("/me");
    useSpotify.setState({ profile: me ? { name: me.display_name, product: me.product } : null, connected: true });
    await Promise.all([refreshDevices(), loadPlaylists(), refreshPlayback()]);
  } catch (e) {
    setError(e);
  }
}

export async function refreshDevices(): Promise<SpotifyDevice[]> {
  try {
    const res = await api<{ devices: { id: string; name: string; type: string; is_active: boolean; volume_percent: number | null }[] }>(
      "/me/player/devices",
    );
    const devices = (res?.devices ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      isActive: d.is_active,
      volume: d.volume_percent,
    }));
    useSpotify.setState({ devices });
    return devices;
  } catch (e) {
    setError(e);
    return [];
  }
}

interface PlaylistApiItem {
  id: string;
  name: string;
  uri: string;
  images?: { url: string }[] | null;
  owner?: { display_name?: string };
  tracks?: { total?: number };
  items?: { total?: number };
}

export async function loadPlaylists() {
  try {
    const all: SpotifyPlaylist[] = [];
    let path: string | null = "/me/playlists?limit=50";
    for (let page = 0; path && page < 6; page++) {
      const res: { items: PlaylistApiItem[]; next: string | null } | null = await api(path);
      for (const p of res?.items ?? []) {
        if (!p) continue;
        all.push({
          id: p.id,
          name: p.name,
          uri: p.uri,
          image: p.images?.[p.images.length > 1 ? 1 : 0]?.url ?? p.images?.[0]?.url,
          owner: p.owner?.display_name,
          total: p.tracks?.total ?? p.items?.total,
        });
      }
      path = res?.next ? res.next.replace(API, "") : null;
    }
    useSpotify.setState({ playlists: all });
  } catch (e) {
    setError(e);
  }
}

interface PlayerApi {
  is_playing: boolean;
  progress_ms: number | null;
  shuffle_state: boolean;
  context: { uri: string } | null;
  device: { id: string; name: string; volume_percent: number | null };
  item: {
    name: string;
    uri?: string;
    duration_ms: number;
    artists?: { name: string }[];
    album?: { images?: { url: string }[] };
    show?: { images?: { url: string }[] };
  } | null;
}

export async function refreshPlayback() {
  try {
    const p = await api<PlayerApi>("/me/player");
    if (!p) {
      useSpotify.setState({ playback: null });
      return;
    }
    const images = p.item?.album?.images ?? p.item?.show?.images ?? [];
    useSpotify.setState({
      playback: {
        isPlaying: p.is_playing,
        track: p.item?.name,
        trackUri: p.item?.uri,
        artists: p.item?.artists?.map((a) => a.name).join(", "),
        image: images[images.length - 1]?.url ?? images[0]?.url,
        contextUri: p.context?.uri ?? null,
        progressMs: p.progress_ms ?? 0,
        durationMs: p.item?.duration_ms ?? 0,
        deviceId: p.device?.id,
        deviceName: p.device?.name,
        volume: p.device?.volume_percent,
        shuffle: p.shuffle_state,
        fetchedAt: Date.now(),
      },
      error: null,
    });
  } catch (e) {
    setError(e);
  }
}

/* ---------------- Steuerung ---------------- */

export function setPreferredDevice(id: string | null) {
  if (id) localStorage.setItem("fokus-spotify-device", id);
  else localStorage.removeItem("fokus-spotify-device");
  useSpotify.setState({ preferredDevice: id });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Findet ein Gerät zum Abspielen. Startet notfalls die Spotify-App. */
async function pickDevice(): Promise<string | null> {
  let devices = await refreshDevices();
  if (!devices.length) {
    useSpotify.setState({ status: "Spotify wird gestartet …" });
    await openExternal("spotify:").catch(() => {});
    for (let i = 0; i < 10 && !devices.length; i++) {
      await sleep(1500);
      devices = await refreshDevices();
    }
    useSpotify.setState({ status: null });
  }
  if (!devices.length) return null;
  const preferred = useSpotify.getState().preferredDevice;
  return (
    devices.find((d) => d.id === preferred)?.id ??
    devices.find((d) => d.isActive)?.id ??
    devices.find((d) => d.type === "Computer")?.id ??
    devices[0].id
  );
}

async function afterCommand() {
  await sleep(400);
  await refreshPlayback();
}

/** Gemerkter Spotify-Stand, um nach der Pause genau dort weiterzuspielen */
export interface SpotifySnapshot {
  contextUri: string | null;
  trackUri: string;
  positionMs: number;
}

/** Aktuellen Wiedergabestand abfragen und merken (null, wenn nichts läuft). */
export async function spotifySnapshot(): Promise<SpotifySnapshot | null> {
  await refreshPlayback();
  const pb = useSpotify.getState().playback;
  if (!pb?.trackUri) return null;
  const elapsed = pb.isPlaying ? Date.now() - pb.fetchedAt : 0;
  return { contextUri: pb.contextUri ?? null, trackUri: pb.trackUri, positionMs: pb.progressMs + elapsed };
}

/** Setzt einen gemerkten Stand fort (gleiche Playlist, gleicher Titel, gleiche Stelle). */
/** Setzt einen gemerkten Stand fort – mit Überblendung, wenn `fade` > 0. */
export async function spotifyRestore(snap: SpotifySnapshot, fade = 0) {
  await spotifySwitch(snap.contextUri, fade, { offsetUri: snap.trackUri, positionMs: snap.positionMs });
}

/* ---------------- Sanfte Übergänge (über die Lautstärke) ---------------- */

/** Lautstärke vor einer Blende – danach wird sie wiederhergestellt */
let baseVolume: number | null = null;

async function setVolumeQuiet(percent: number) {
  try {
    await api(`/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(percent)))}`, { method: "PUT" });
  } catch {
    /* manche Geräte erlauben keine Lautstärkeregelung */
  }
}

function currentBase(): number | null {
  if (baseVolume !== null) return baseVolume;
  const v = useSpotify.getState().playback?.volume;
  return typeof v === "number" ? v : null;
}

async function rampVolume(from: number, to: number, seconds: number) {
  const steps = Math.max(2, Math.round(seconds * 2));
  for (let i = 1; i <= steps; i++) {
    await sleep((seconds * 1000) / steps);
    await setVolumeQuiet(from + ((to - from) * i) / steps);
  }
}

/** Leiser werden, anhalten und die ursprüngliche Lautstärke wiederherstellen. */
export async function spotifyFadeOutAndPause(seconds: number) {
  if (!useSpotify.getState().playback?.isPlaying) return;
  const base = currentBase();
  if (base !== null && seconds > 0) {
    baseVolume = base;
    await rampVolume(base, 0, seconds);
  }
  await spotifyPause();
  if (base !== null && seconds > 0) {
    await setVolumeQuiet(base);
    baseVolume = null;
  }
}

/** Abspielen und dabei langsam lauter werden. */
export async function spotifyPlayFadeIn(uri: string | null, seconds: number, opts: { offsetUri?: string; positionMs?: number } = {}) {
  const base = currentBase();
  const canFade = base !== null && seconds > 0 && !!useSpotify.getState().playback?.deviceId;
  if (canFade) {
    baseVolume = base;
    await setVolumeQuiet(0);
  }
  await spotifyPlay(uri, opts);
  if (canFade) {
    await rampVolume(0, base!, seconds);
    baseVolume = null;
  }
}

/**
 * Wechselt innerhalb von Spotify die Playlist: erst leiser, dann die neue
 * Playlist starten und wieder lauter werden (Spotify spielt immer nur einen Titel).
 */
export async function spotifySwitch(uri: string | null, seconds: number, opts: { offsetUri?: string; positionMs?: number } = {}) {
  const base = currentBase();
  if (base === null || seconds <= 0 || !useSpotify.getState().playback?.isPlaying) {
    await spotifyPlayFadeIn(uri, seconds, opts);
    return;
  }
  baseVolume = base;
  await rampVolume(base, 0, seconds / 2);
  await spotifyPlay(uri, opts);
  await rampVolume(0, base, seconds / 2);
  baseVolume = null;
}

/** Spielt eine Playlist (oder setzt die Wiedergabe fort, wenn `uri` fehlt). */
export async function spotifyPlay(uri?: string | null, opts: { offsetUri?: string; positionMs?: number } = {}) {
  try {
    useSpotify.setState({ error: null });
    const device = await pickDevice();
    if (!device) throw new SpotifyError(404, "", "NO_ACTIVE_DEVICE");
    let body: string | undefined;
    if (uri) {
      body = JSON.stringify({
        context_uri: uri,
        ...(opts.offsetUri ? { offset: { uri: opts.offsetUri } } : {}),
        ...(opts.positionMs ? { position_ms: Math.max(0, Math.round(opts.positionMs)) } : {}),
      });
    } else if (opts.offsetUri) {
      body = JSON.stringify({ uris: [opts.offsetUri], position_ms: Math.max(0, Math.round(opts.positionMs ?? 0)) });
    }
    await api(`/me/player/play?device_id=${encodeURIComponent(device)}`, { method: "PUT", body });
    await afterCommand();
  } catch (e) {
    setError(e);
  }
}

export async function spotifyPause() {
  try {
    await api("/me/player/pause", { method: "PUT" });
    await afterCommand();
  } catch (e) {
    // Bereits pausiert → kein Fehler anzeigen
    if (!(e instanceof SpotifyError && e.status === 403)) setError(e);
  }
}

export async function spotifyNext() {
  try {
    await api("/me/player/next", { method: "POST" });
    await afterCommand();
  } catch (e) {
    setError(e);
  }
}

export async function spotifyPrev() {
  try {
    await api("/me/player/previous", { method: "POST" });
    await afterCommand();
  } catch (e) {
    setError(e);
  }
}

export async function spotifyVolume(percent: number) {
  try {
    await api(`/me/player/volume?volume_percent=${Math.round(percent)}`, { method: "PUT" });
  } catch (e) {
    setError(e);
  }
}

export async function spotifyShuffle(on: boolean) {
  try {
    await api(`/me/player/shuffle?state=${on}`, { method: "PUT" });
    await afterCommand();
  } catch (e) {
    setError(e);
  }
}

export async function spotifyTransfer(deviceId: string) {
  try {
    setPreferredDevice(deviceId);
    await api("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [deviceId], play: false }) });
    await afterCommand();
  } catch (e) {
    setError(e);
  }
}

export function isSpotifyConnected() {
  return !!loadToken();
}

/* ---------------- Hintergrund-Aktualisierung ---------------- */

let pollStarted = false;
export function startSpotifyPolling() {
  if (pollStarted) return;
  pollStarted = true;
  if (loadToken()) void initSpotify();
  setInterval(() => {
    if (!document.hidden && useSpotify.getState().connected) void refreshPlayback();
  }, 8000);
}
