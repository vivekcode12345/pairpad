import { useState, useEffect, useRef, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import * as Y from 'yjs';

import { HomeLink } from './components/ui';
import './monacoSetup';
import './App.css';

const IDLE_GAP_MAX = 2000;
const SPEEDS = [1, 2, 4, 8];
const MARKER_KINDS = new Set(['join', 'leave', 'lang', 'run', 'mark']);

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Build a compressed-time timeline: idle gaps longer than IDLE_GAP_MAX are
// shortened to IDLE_GAP_MAX so long pauses don't slow the replay down.
function buildTimeline(events) {
  const timeline = [];
  let clock = 0;
  let prevT = 0;
  for (const ev of events) {
    const t = typeof ev.t === 'number' ? ev.t : 0;
    const gap = Math.max(t - prevT, 0);
    clock += Math.min(gap, IDLE_GAP_MAX);
    prevT = t;
    timeline.push({ ct: clock, event: ev });
  }
  const total = timeline.length ? timeline[timeline.length - 1].ct : 0;
  return { timeline, total };
}

function formatTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function describeEvent(ev) {
  switch (ev.k) {
    case 'join':
      return `${ev.u} joined`;
    case 'leave':
      return `${ev.u} left`;
    case 'lang':
      return `Language → ${ev.v}`;
    case 'run':
      return `${ev.u} ran the code`;
    case 'mark':
      return ev.label || 'mark';
    default:
      return ev.k;
  }
}

const Replay = ({ roomId }) => {
  const [status, setStatus] = useState('loading'); // loading | error | ready
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [total, setTotal] = useState(0);
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [users, setUsers] = useState([]);
  const [lastRun, setLastRun] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [clock, setClock] = useState(0);

  // Mutable playback state kept in refs so the rAF loop always reads fresh values.
  const timelineRef = useRef([]);
  const totalRef = useRef(0);
  const docRef = useRef(null);
  const appliedRef = useRef(-1);
  const langRef = useRef(null);
  const usersRef = useRef(new Set());
  const lastRunRef = useRef(null);
  const clockRef = useRef(0);
  const speedRef = useRef(1);
  const playingRef = useRef(false);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const syncDisplay = useCallback(() => {
    setText(docRef.current ? docRef.current.getText('monaco').toString() : '');
    setLanguage(langRef.current || 'javascript');
    setUsers([...usersRef.current]);
    setLastRun(lastRunRef.current);
  }, []);

  const resetDoc = useCallback(() => {
    if (docRef.current) docRef.current.destroy();
    docRef.current = new Y.Doc();
    langRef.current = null;
    usersRef.current = new Set();
    lastRunRef.current = null;
    appliedRef.current = -1;
  }, []);

  const applyEvent = useCallback((event) => {
    if (event.k === 'doc') {
      Y.applyUpdate(docRef.current, base64ToBytes(event.d));
    } else if (event.k === 'lang') {
      langRef.current = event.v;
    } else if (event.k === 'join') {
      usersRef.current.add(event.u);
    } else if (event.k === 'leave') {
      usersRef.current.delete(event.u);
    } else if (event.k === 'run') {
      lastRunRef.current = { u: event.u, out: event.out };
    }
  }, []);

  // Apply timeline events forward incrementally; rebuild from scratch only
  // when seeking backwards.
  const applyUpTo = useCallback((targetIndex) => {
    if (targetIndex < appliedRef.current) resetDoc();
    const tl = timelineRef.current;
    while (appliedRef.current < targetIndex) {
      const idx = appliedRef.current + 1;
      if (idx >= tl.length) break;
      applyEvent(tl[idx].event);
      appliedRef.current = idx;
    }
  }, [applyEvent, resetDoc]);

  // Largest index whose compressed time <= ct (-1 if none).
  const upperBound = useCallback((ct) => {
    const tl = timelineRef.current;
    let ans = -1;
    for (let i = 0; i < tl.length; i++) {
      if (tl[i].ct <= ct) ans = i;
      else break;
    }
    return ans;
  }, []);

  const seek = useCallback((ct) => {
    playingRef.current = false;
    setPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const clamped = Math.max(0, Math.min(ct, totalRef.current));
    clockRef.current = clamped;
    setClock(clamped);
    applyUpTo(upperBound(clamped));
    syncDisplay();
  }, [applyUpTo, upperBound, syncDisplay]);

  const handlePlayPause = useCallback(() => {
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    // Play at (or past) the end restarts from the beginning.
    if (clockRef.current >= totalRef.current) {
      resetDoc();
      clockRef.current = 0;
      setClock(0);
      applyUpTo(upperBound(0));
      syncDisplay();
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    playingRef.current = true;
    setPlaying(true);
    lastTsRef.current = performance.now();

    const loop = (ts) => {
      if (!playingRef.current) return;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;
      clockRef.current = Math.min(clockRef.current + dt * speedRef.current, totalRef.current);
      setClock(clockRef.current);
      const target = upperBound(clockRef.current);
      const before = appliedRef.current;
      applyUpTo(target);
      if (appliedRef.current !== before) syncDisplay();
      if (clockRef.current >= totalRef.current) {
        playingRef.current = false;
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [resetDoc, applyUpTo, upperBound, syncDisplay]);

  // Fetch the recording once and prepare the timeline.
  // (Initial state is already status='loading', error=''.)
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/replay/${encodeURIComponent(roomId)}`)
      .then((res) =>
        res.json().then((data) => ({ ok: res.ok, status: res.status, data }))
      )
      .then(({ ok, status: code, data }) => {
        if (cancelled) return;
        if (!ok) {
          throw new Error((data && data.error) || `Request failed (${code})`);
        }
        const events = (data && data.events) || [];
        const built = buildTimeline(events);
        timelineRef.current = built.timeline;
        totalRef.current = built.total;
        setTimeline(built.timeline);
        setTotal(built.total);
        resetDoc();
        applyUpTo(upperBound(0));
        clockRef.current = 0;
        setClock(0);
        syncDisplay();
        setRecording(data);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err && err.message ? err.message : 'Failed to load');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, resetDoc, applyUpTo, upperBound, syncDisplay]);

  // Cleanup on unmount: stop the animation frame and destroy the Y.Doc.
  useEffect(() => {
    return () => {
      playingRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (docRef.current) {
        docRef.current.destroy();
        docRef.current = null;
      }
    };
  }, []);

  const markerEvents = timeline
    .map((entry, idx) => ({ ...entry, idx }))
    .filter((entry) => MARKER_KINDS.has(entry.event.k));

  let currentMarker = -1;
  markerEvents.forEach((m, i) => {
    if (m.ct <= clock) currentMarker = i;
  });

  const exportJson = () => {
    if (!recording) return;
    const blob = new Blob([JSON.stringify(recording, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${roomId}.replay.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const goBack = () => {
    window.location.href = '/';
  };

  if (status === 'loading') {
    return (
      <div className="replay-container">
        <div className="replay-topbar">
          <HomeLink />
          <h2>Replay: {roomId}</h2>
          <span className="replay-spacer" />
          <button onClick={goBack}>Back</button>
        </div>
        <div className="replay-message">Loading recording…</div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="replay-container">
        <div className="replay-topbar">
          <HomeLink />
          <h2>Replay: {roomId}</h2>
          <span className="replay-spacer" />
          <button onClick={goBack}>Back</button>
        </div>
        <div className="replay-message">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="replay-container">
      <div className="replay-topbar">
        <HomeLink />
        <h2>Replay: {roomId}</h2>
        {recording && recording.endedAt === null && (
          <span className="replay-badge live">Live session still in progress</span>
        )}
        {recording && recording.truncated && (
          <span className="replay-badge">This recording was truncated (size limit)</span>
        )}
        <span className="replay-spacer" />
        <button onClick={exportJson}>Export JSON</button>
        <button onClick={goBack}>Back</button>
      </div>

      <div className="replay-editor">
        <Editor
          height="100%"
          language={language}
          theme="vs-light"
          value={text}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 16,
          }}
        />
      </div>

      <div className="replay-controls">
        <button onClick={handlePlayPause}>{playing ? 'Pause' : 'Play'}</button>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={speed === s ? 'speed active' : 'speed'}
            onClick={() => setSpeed(s)}
          >
            {s}x
          </button>
        ))}
        <input
          type="range"
          min={0}
          max={total}
          step={1}
          value={clock}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="replay-time">
          {formatTime(clock)} / {formatTime(total)}
        </span>
      </div>

      <div className="replay-bottom">
        <div className="replay-events">
          <div className="replay-users-online">
            Users: {users.length ? users.join(', ') : '—'}
          </div>
          {markerEvents.map((m) => (
            <div
              key={m.idx}
              className={`${m.event.k === 'mark' ? 'replay-event-mark ' : ''}${
                markerEvents[currentMarker] &&
                markerEvents[currentMarker].idx === m.idx
                  ? 'replay-event current'
                  : 'replay-event'
              }`}
              onClick={() => seek(m.ct)}
            >
              <span className="replay-event-t">{formatTime(m.ct)}</span>
              <span> {describeEvent(m.event)}</span>
            </div>
          ))}
        </div>
        <div className="replay-output">
          {lastRun ? (
            <>
              <div className="replay-output-head">Output — {lastRun.u}</div>
              <pre className="replay-output-body">{lastRun.out}</pre>
            </>
          ) : (
            <div className="replay-output-head">No run yet</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Replay;
