"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  createLocalVideoTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from "livekit-client";

// ─── Types ────────────────────────────────────────────────────────────────────

type BroadcastState =
  | "idle"        // not started
  | "starting"    // requesting media + connecting
  | "live"        // connected and publishing
  | "ending"      // stop requested
  | "ended";      // stream finished

type Props = {
  communityId: string;
  devWallet: string;
  onEnded?: () => void; // called when stream ends so parent can refresh
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function LiveStreamBroadcaster({ communityId, devWallet, onEnded }: Props) {
  const [state, setState]           = useState<BroadcastState>("idle");
  const [err, setErr]               = useState<string | null>(null);
  const [roomName, setRoomName]     = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [streamTitle, setStreamTitle] = useState("");
  const [hasVideo, setHasVideo]     = useState(false);
  const [micMuted, setMicMuted]     = useState(false);
  const [camOff, setCamOff]         = useState(false);
  const [elapsed, setElapsed]       = useState(0); // seconds since went live

  const roomRef         = useRef<Room | null>(null);
  const audioTrackRef   = useRef<LocalAudioTrack | null>(null);
  const videoTrackRef   = useRef<LocalVideoTrack | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const liveVideoRef    = useRef<HTMLVideoElement>(null); // self-view while live
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef    = useRef<number>(0);

  // ── Preview video in setup screen ─────────────────────────────────────────
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!hasVideo) {
      setPreviewStream(null);
      return;
    }
    let active = true;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((s) => { if (active) setPreviewStream(s); })
      .catch(() => { if (active) setPreviewStream(null); });
    return () => {
      active = false;
    };
  }, [hasVideo]);

  useEffect(() => {
    if (!videoPreviewRef.current) return;
    if (previewStream) {
      videoPreviewRef.current.srcObject = previewStream;
    } else {
      videoPreviewRef.current.srcObject = null;
    }
  }, [previewStream]);

  // Stop preview stream when we go live (LiveKit takes over the camera)
  useEffect(() => {
    if (state === "live" && previewStream) {
      previewStream.getTracks().forEach((t) => t.stop());
      setPreviewStream(null);
    }
  }, [state, previewStream]);

  // ── Elapsed timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (state === "live") {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  function fmtElapsed(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  // ── Go Live ────────────────────────────────────────────────────────────────
  const goLive = useCallback(async () => {
    setErr(null);
    setState("starting");

    try {
      // 1. Tell the server to create the room + DB row
      const startRes = await fetch("/api/livekit/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          communityId,
          title:    streamTitle.trim() || null,
          hasVideo,
        }),
      });

      const startJson = await startRes.json().catch(() => ({}));
      if (!startRes.ok) throw new Error(startJson?.error ?? "Failed to start stream");

      const newRoomName: string = startJson.roomName;
      setRoomName(newRoomName);

      // 2. Get a publisher token
      const tokenRes = await fetch(
        `/api/livekit/token?roomName=${encodeURIComponent(newRoomName)}&communityId=${encodeURIComponent(communityId)}`
      );
      const tokenJson = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) throw new Error(tokenJson?.error ?? "Failed to get token");

      const { token, livekitUrl } = tokenJson;
      if (!livekitUrl) throw new Error("LiveKit URL not configured");

      // 3. Create local tracks
      const [audioTrack, videoTrack] = await Promise.all([
        createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true }),
        hasVideo ? createLocalVideoTrack({ resolution: { width: 1280, height: 720, frameRate: 30 } }) : Promise.resolve(null),
      ]);

      audioTrackRef.current = audioTrack;
      videoTrackRef.current = videoTrack;

      // 4. Connect to LiveKit room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      roomRef.current = room;

      // Track viewer count via participant changes
      const updateViewerCount = () => {
        // Count remote participants (viewers) — subtract 0 since dev is local
        setViewerCount(room.remoteParticipants.size);
      };

      room
        .on(RoomEvent.ParticipantConnected,    updateViewerCount)
        .on(RoomEvent.ParticipantDisconnected, updateViewerCount)
        .on(RoomEvent.Disconnected, () => {
          setState((prev) => prev === "live" ? "ended" : prev);
        });

      await room.connect(livekitUrl, token);

      // 5. Publish tracks
      await room.localParticipant.publishTrack(audioTrack, {
        source: Track.Source.Microphone,
      });

      if (videoTrack) {
        await room.localParticipant.publishTrack(videoTrack, {
          source: Track.Source.Camera,
        });
      }

      updateViewerCount();
      setState("live");

      // Attach local video track to self-view element (using raw MediaStreamTrack)
      if (videoTrack && liveVideoRef.current) {
        const ms = new MediaStream([videoTrack.mediaStreamTrack]);
        liveVideoRef.current.srcObject = ms;
      }

    } catch (e: any) {
      setErr(e?.message ?? "Failed to go live");
      setState("idle");
      // Clean up any tracks we may have created
      audioTrackRef.current?.stop();
      videoTrackRef.current?.stop();
      audioTrackRef.current = null;
      videoTrackRef.current = null;
    }
  }, [communityId, streamTitle, hasVideo]);

  // ── End Stream ─────────────────────────────────────────────────────────────
  const endStream = useCallback(async () => {
    if (!roomName) return;
    setState("ending");

    try {
      // Stop local tracks first
      audioTrackRef.current?.stop();
      videoTrackRef.current?.stop();
      audioTrackRef.current = null;
      videoTrackRef.current = null;

      // Disconnect from room
      await roomRef.current?.disconnect();
      roomRef.current = null;

      // Tell server to mark stream ended + delete LiveKit room
      await fetch("/api/livekit/stream", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, communityId }),
      });

    } catch {
      // Even if server call fails, we consider it ended locally
    } finally {
      setState("ended");
      onEnded?.();
    }
  }, [roomName, communityId, onEnded]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      audioTrackRef.current?.stop();
      videoTrackRef.current?.stop();
      roomRef.current?.disconnect();
    };
  }, []);

  // ── Mic toggle ─────────────────────────────────────────────────────────────
  async function toggleMic() {
    if (!audioTrackRef.current) return;
    if (micMuted) {
      await audioTrackRef.current.unmute();
      setMicMuted(false);
    } else {
      await audioTrackRef.current.mute();
      setMicMuted(true);
    }
  }

  // ── Camera toggle ──────────────────────────────────────────────────────────
  async function toggleCam() {
    if (!videoTrackRef.current) return;
    if (camOff) {
      await videoTrackRef.current.unmute();
      setCamOff(false);
    } else {
      await videoTrackRef.current.mute();
      setCamOff(true);
    }
  }

  // ── Render: ended ──────────────────────────────────────────────────────────
  if (state === "ended") {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <div className="text-3xl mb-2">✅</div>
        <div className="text-sm font-semibold text-white">Stream ended</div>
        <div className="mt-1 text-xs text-zinc-500">Duration: {fmtElapsed(elapsed || 0)}</div>
        <button
          onClick={() => { setState("idle"); setRoomName(null); setElapsed(0); }}
          className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs hover:bg-white/10 transition"
        >
          Go live again
        </button>
      </div>
    );
  }

  // ── Render: live ───────────────────────────────────────────────────────────
  if (state === "live" || state === "ending") {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-black/60 overflow-hidden">
        {/* Live header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 items-center justify-center">
              <span className="animate-ping absolute h-2.5 w-2.5 rounded-full bg-red-500 opacity-75" />
              <span className="relative h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="text-sm font-semibold text-red-400">LIVE</span>
            <span className="font-mono text-xs text-zinc-500">{fmtElapsed(elapsed)}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
              </svg>
              <span className="font-mono">{viewerCount}</span>
            </div>

            {streamTitle && (
              <span className="text-xs text-zinc-500 truncate max-w-[160px]">{streamTitle}</span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 p-4">
          {/* Mic */}
          <button
            onClick={toggleMic}
            className={[
              "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition",
              micMuted
                ? "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                : "border-white/10 bg-white/5 text-white hover:bg-white/10"
            ].join(" ")}
          >
            {micMuted ? (
              <>
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                Unmute
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
                Mute
              </>
            )}
          </button>

          {/* Camera (only if video enabled) */}
          {hasVideo && (
            <button
              onClick={toggleCam}
              className={[
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition",
                camOff
                  ? "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                  : "border-white/10 bg-white/5 text-white hover:bg-white/10"
              ].join(" ")}
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12.553 1.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
              </svg>
              {camOff ? "Show Camera" : "Hide Camera"}
            </button>
          )}

          {/* End stream */}
          <button
            onClick={endStream}
            disabled={state === "ending"}
            className="ml-auto flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-60 transition"
          >
            {state === "ending" ? "Ending…" : "End Stream"}
          </button>
        </div>

        {/* Self-view — only shown when video is enabled */}
        {hasVideo && (
          <div className="relative mx-4 mb-3 overflow-hidden rounded-xl border border-white/10 bg-black aspect-video">
            <video
              ref={liveVideoRef}
              autoPlay
              muted
              playsInline
              className={[
                "h-full w-full object-cover scale-x-[-1] transition-opacity duration-300",
                camOff ? "opacity-0" : "opacity-100"
              ].join(" ")}
            />
            {camOff && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
                📷 Camera off
              </div>
            )}
            {/* PIP label */}
            <div className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] text-zinc-400 backdrop-blur">
              Your stream preview
            </div>
          </div>
        )}

        <div className="px-4 pb-3 text-[11px] text-zinc-600">
          {micMuted && <span className="text-red-400">🎙 Muted · </span>}
          {hasVideo && camOff && <span className="text-red-400">📷 Camera off · </span>}
          Room: <span className="font-mono">{roomName}</span>
        </div>
      </div>
    );
  }

  // ── Render: setup / starting ───────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <h3 className="text-sm font-semibold">Go Live</h3>
      </div>

      {err && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}

      {/* Stream title */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-zinc-400">Stream title (optional)</label>
        <input
          type="text"
          value={streamTitle}
          onChange={(e) => setStreamTitle(e.target.value)}
          placeholder="e.g. AMA, New coin launch…"
          maxLength={80}
          className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-white/20 focus:outline-none"
        />
      </div>

      {/* Video toggle */}
      <div className="mb-4 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
        <div>
          <div className="text-xs font-semibold text-white">Enable camera</div>
          <div className="text-[11px] text-zinc-500">Audio only if off</div>
        </div>
        <button
          onClick={() => setHasVideo((v) => !v)}
          className={[
            "relative h-6 w-11 rounded-full transition-colors duration-200",
            hasVideo ? "bg-white" : "bg-zinc-700"
          ].join(" ")}
        >
          <span className={[
            "absolute top-0.5 h-5 w-5 rounded-full bg-black shadow transition-transform duration-200",
            hasVideo ? "translate-x-5" : "translate-x-0.5"
          ].join(" ")} />
        </button>
      </div>

      {/* Camera preview */}
      {hasVideo && (
        <div className="mb-4 overflow-hidden rounded-xl border border-white/10 bg-black/40 aspect-video">
          {previewStream ? (
            <video
              ref={videoPreviewRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover scale-x-[-1]" // mirror for selfie view
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-zinc-600">
              Requesting camera…
            </div>
          )}
        </div>
      )}

      {/* Go live button */}
      <button
        onClick={goLive}
        disabled={state === "starting"}
        className="w-full rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 transition"
      >
        {state === "starting" ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Going live…
          </span>
        ) : "🔴 Go Live"}
      </button>

      <p className="mt-2 text-center text-[11px] text-zinc-600">
        All community members will be notified
      </p>
    </div>
  );
}
