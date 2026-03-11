"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
} from "livekit-client";

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewerState =
  | "idle"         // not yet connected
  | "connecting"   // fetching token + joining room
  | "watching"     // live and receiving stream
  | "buffering"    // connected but no tracks yet
  | "ended"        // stream ended while watching
  | "error";       // failed to connect

type StreamInfo = {
  roomName:    string;
  devWallet:   string;
  title:       string | null;
  hasVideo:    boolean;
  viewerCount: number;
  startedAt:   string;
};

type Props = {
  communityId: string;
  stream:      StreamInfo;
  devName?:    string | null;
  devPfpUrl?:  string | null;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function LiveStreamViewer({
  communityId,
  stream,
  devName,
  devPfpUrl,
}: Props) {
  const [state, setState]           = useState<ViewerState>("idle");
  const [err, setErr]               = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(stream.viewerCount ?? 0);
  const [audioMuted, setAudioMuted] = useState(false);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);
  const [elapsed, setElapsed]       = useState(0);

  const roomRef     = useRef<Room | null>(null);
  const audioRef    = useRef<HTMLAudioElement>(null);
  const videoRef    = useRef<HTMLVideoElement>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(
    stream.startedAt ? new Date(stream.startedAt).getTime() : Date.now()
  );

  // ── Elapsed timer (counts up from stream start time) ──────────────────────
  useEffect(() => {
    if (state !== "watching" && state !== "buffering") return;

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  function fmtElapsed(s: number) {
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
    return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  }

  // ── Attach remote track to media element ──────────────────────────────────
  function attachTrack(track: RemoteTrack) {
    if (track.kind === Track.Kind.Audio && audioRef.current) {
      track.attach(audioRef.current);
    }
    if (track.kind === Track.Kind.Video && videoRef.current) {
      track.attach(videoRef.current);
      setHasVideoTrack(true);
    }
  }

  function detachTrack(track: RemoteTrack) {
    track.detach();
    if (track.kind === Track.Kind.Video) {
      setHasVideoTrack(false);
    }
  }

  // ── Connect ───────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    setErr(null);
    setState("connecting");

    try {
      // 1. Get viewer token (subscriber-only)
      const tokenRes = await fetch(
        `/api/livekit/token?roomName=${encodeURIComponent(stream.roomName)}&communityId=${encodeURIComponent(communityId)}`
      );
      const tokenJson = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) throw new Error(tokenJson?.error ?? "Failed to get token");

      const { token, livekitUrl } = tokenJson;
      if (!livekitUrl) throw new Error("LiveKit URL not configured");

      // 2. Create room and set up event listeners BEFORE connecting
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      const updateViewers = () => {
        // remote participants = other viewers + the broadcaster
        // broadcaster publishes, so we count remoteParticipants - 1 (the dev)
        // but simpler: just show total remote count as "watching"
        setViewerCount(room.remoteParticipants.size);
      };

      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          attachTrack(track);
          setState("watching");
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          detachTrack(track);
        })
        .on(RoomEvent.ParticipantConnected, updateViewers)
        .on(RoomEvent.ParticipantDisconnected, updateViewers)
        .on(RoomEvent.Disconnected, () => {
          setState("ended");
          if (timerRef.current) clearInterval(timerRef.current);
        })
        .on(RoomEvent.Reconnecting, () => setState("buffering"))
        .on(RoomEvent.Reconnected,  () => setState("watching"));

      // 3. Connect
      await room.connect(livekitUrl, token);

      setState("buffering"); // connected — waiting for track subscription

      updateViewers();

      // 4. Attach any tracks that are already present (e.g. rejoining mid-stream)
      room.remoteParticipants.forEach((participant: RemoteParticipant) => {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.isSubscribed) {
            attachTrack(pub.track as RemoteTrack);
            setState("watching");
          }
        });
      });

    } catch (e: any) {
      setErr(e?.message ?? "Failed to connect");
      setState("error");
    }
  }, [communityId, stream.roomName]);

  // ── Disconnect ────────────────────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setState("idle");
    setHasVideoTrack(false);
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      roomRef.current?.disconnect();
    };
  }, []);

  // ── Audio mute toggle (local only — doesn't affect the stream) ────────────
  function toggleAudio() {
    if (!audioRef.current) return;
    audioRef.current.muted = !audioRef.current.muted;
    setAudioMuted((m) => !m);
  }

  // ── Shared header (shown in all active states) ────────────────────────────
  function StreamHeader() {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Dev avatar */}
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/5">
            {devPfpUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={devPfpUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                {(devName ?? "D").slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {/* LIVE badge */}
              <span className="flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                LIVE
              </span>
              <span className="truncate text-sm font-semibold text-white">
                {devName ?? `${stream.devWallet.slice(0,4)}…${stream.devWallet.slice(-4)}`}
              </span>
            </div>
            {stream.title && (
              <div className="truncate text-[11px] text-zinc-500">{stream.title}</div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* Elapsed */}
          <span className="font-mono text-xs text-zinc-500">{fmtElapsed(elapsed)}</span>

          {/* Viewer count */}
          <div className="flex items-center gap-1 text-xs text-zinc-400">
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
            </svg>
            <span className="font-mono">{viewerCount}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: idle (not yet clicked watch) ──────────────────────────────────
  if (state === "idle") {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-black/60 overflow-hidden">
        <StreamHeader />
        <div className="flex flex-col items-center justify-center gap-4 p-8">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm text-zinc-300">
              {stream.hasVideo ? "Video + Audio stream" : "Audio stream"} is live
            </span>
          </div>
          <button
            onClick={connect}
            className="flex items-center gap-2 rounded-xl bg-red-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-600 transition"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
            Watch Live
          </button>
        </div>
      </div>
    );
  }

  // ── Render: error ─────────────────────────────────────────────────────────
  if (state === "error") {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-black/60 overflow-hidden">
        <StreamHeader />
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="text-sm text-red-300">{err}</div>
          <button
            onClick={connect}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs hover:bg-white/10 transition"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── Render: ended ─────────────────────────────────────────────────────────
  if (state === "ended") {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
        <div className="flex flex-col items-center gap-2 p-8 text-center">
          <div className="text-3xl">📻</div>
          <div className="text-sm font-semibold text-white">Stream ended</div>
          <div className="text-xs text-zinc-500">
            {devName ?? "The dev"} ended the stream
          </div>
        </div>
      </div>
    );
  }

  // ── Render: connecting / buffering / watching ─────────────────────────────
  return (
    <div className="rounded-2xl border border-red-500/20 bg-black/60 overflow-hidden">
      <StreamHeader />

      {/* Hidden audio element — always present so audio plays immediately */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {/* Video area */}
      {stream.hasVideo ? (
        <div className="relative bg-black aspect-video">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className={[
              "h-full w-full object-contain transition-opacity duration-300",
              hasVideoTrack ? "opacity-100" : "opacity-0"
            ].join(" ")}
          />

          {/* Buffering overlay */}
          {(state === "connecting" || state === "buffering" || !hasVideoTrack) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80">
              <svg className="h-6 w-6 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              <span className="text-xs text-zinc-500">
                {state === "connecting" ? "Connecting…" : "Buffering…"}
              </span>
            </div>
          )}
        </div>
      ) : (
        /* Audio-only visual */
        <div className="flex flex-col items-center justify-center gap-4 py-10">
          {/* Animated waveform bars */}
          <div className="flex items-end gap-1 h-10">
            {[0.4, 0.7, 1.0, 0.8, 0.5, 0.9, 0.6, 1.0, 0.7, 0.4].map((h, i) => (
              <div
                key={i}
                className={[
                  "w-1.5 rounded-full bg-red-500 transition-all",
                  state === "watching" && !audioMuted ? "animate-pulse" : "opacity-30"
                ].join(" ")}
                style={{
                  height: `${h * 100}%`,
                  animationDelay: `${i * 80}ms`,
                  animationDuration: `${600 + i * 60}ms`
                }}
              />
            ))}
          </div>

          <div className="text-xs text-zinc-500">
            {state === "connecting" ? "Connecting to stream…" :
             state === "buffering"  ? "Buffering…" :
             audioMuted ? "🔇 Audio muted" : "🎙 Listening live"}
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          {/* Mute/unmute audio */}
          <button
            onClick={toggleAudio}
            className={[
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition",
              audioMuted
                ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
            ].join(" ")}
          >
            {audioMuted ? (
              <>
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                Unmute
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                </svg>
                Mute
              </>
            )}
          </button>
        </div>

        {/* Leave stream */}
        <button
          onClick={disconnect}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-white/10 hover:text-white transition"
        >
          Leave
        </button>
      </div>
    </div>
  );
}
