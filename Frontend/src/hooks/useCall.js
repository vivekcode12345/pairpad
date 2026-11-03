import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const FETCH_TIMEOUT_MS = 3000;
const ICE_RESTART_WAIT_MS = 5000;

function humanErrorMessage(error) {
  const name = error && error.name ? error.name : '';
  if (name === 'NotAllowedError') {
    return 'Camera or microphone permission was denied. Allow it in the browser address bar and try again.';
  }
  if (name === 'NotFoundError') {
    return 'No camera or microphone found.';
  }
  if (name === 'NotReadableError') {
    return 'Your camera or microphone is being used by another app.';
  }
  return 'Could not access camera or microphone. Please check your device settings and try again.';
}

export function useCall({ socket, participants }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [stopReason, setStopReason] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const [peers, setPeers] = useState({});

  const localStreamRef = useRef(null);
  const peerConnections = useRef(new Map());
  const candidateQueues = useRef(new Map());
  const remoteDescriptionsSet = useRef(new Set());
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const iceRestartTimers = useRef(new Map());
  const isInCallRef = useRef(false);
  const mountedRef = useRef(true);
  const participantsRef = useRef(participants);
  const micOnRef = useRef(micOn);
  const camOnRef = useRef(camOn);
  const peersRef = useRef(peers);
  const leaveCallRef = useRef(null);
  const trackCleanupRef = useRef([]);

  useEffect(() => {
    participantsRef.current = participants;
    micOnRef.current = micOn;
    camOnRef.current = camOn;
    peersRef.current = peers;
  }, [participants, micOn, camOn, peers]);

  const closePeer = useCallback((id) => {
    const peer = peerConnections.current.get(id);
    if (peer) {
      try { peer.close(); } catch { /* ignore */ }
      peerConnections.current.delete(id);
    }
    candidateQueues.current.delete(id);
    remoteDescriptionsSet.current.delete(id);
    const timer = iceRestartTimers.current.get(id);
    if (timer) { clearTimeout(timer); iceRestartTimers.current.delete(id); }
    setPeers((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const updatePeerFlag = useCallback((id, key, value) => {
    setPeers((current) => {
      const p = current[id];
      if (!p) return current;
      return { ...current, [id]: { ...p, [key]: value } };
    });
  }, []);

  const updatePeerStream = useCallback((id, stream) => {
    setPeers((current) => {
      const p = current[id];
      if (!p) return current;
      return { ...current, [id]: { ...p, stream } };
    });
  }, []);

  const updatePeerConnection = useCallback((id, connection) => {
    setPeers((current) => {
      const p = current[id];
      if (!p) return current;
      return { ...current, [id]: { ...p, connection } };
    });
  }, []);

  const flushCandidates = useCallback((id) => {
    const peer = peerConnections.current.get(id);
    const queue = candidateQueues.current.get(id) || [];
    if (!peer || queue.length === 0) return;
    const pending = [...queue];
    queue.length = 0;
    candidateQueues.current.set(id, queue);
    pending.forEach((candidate) => {
      try { peer.addIceCandidate(candidate); } catch { /* ignore */ }
    });
  }, []);

  const addQueuedCandidate = useCallback((id, candidate) => {
    const queue = candidateQueues.current.get(id) || [];
    queue.push(candidate);
    candidateQueues.current.set(id, queue);
    if (remoteDescriptionsSet.current.has(id)) {
      flushCandidates(id);
    }
  }, [flushCandidates]);

  const createPeer = useCallback((id, name, audio, video, initiator) => {
    if (peerConnections.current.has(id)) return null;
    const peer = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
    peerConnections.current.set(id, peer);

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    }

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit('video-ice-candidate', { targetId: id, candidate: event.candidate });
    };

    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) updatePeerStream(id, stream);
    };

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      updatePeerConnection(id, state);

      if (state === 'disconnected') {
        updatePeerConnection(id, 'reconnecting');
        const existing = iceRestartTimers.current.get(id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          const p2 = peerConnections.current.get(id);
          if (!p2 || p2.connectionState === 'connected') return;
          if (initiator) {
            p2.createOffer({ iceRestart: true })
              .then((offer) => p2.setLocalDescription(offer).then(() => offer))
              .then((offer) => {
                socket.emit('video-offer', { targetId: id, offer });
              })
              .catch(() => updatePeerConnection(id, 'failed'));
          } else {
            updatePeerConnection(id, 'failed');
          }
        }, ICE_RESTART_WAIT_MS);
        iceRestartTimers.current.set(id, timer);
      }

      if (state === 'failed') {
        const existing = iceRestartTimers.current.get(id);
        if (existing) clearTimeout(existing);
        if (initiator) {
          peer.createOffer({ iceRestart: true })
            .then((offer) => peer.setLocalDescription(offer).then(() => offer))
            .then((offer) => {
              socket.emit('video-offer', { targetId: id, offer });
            })
            .catch(() => {
              updatePeerConnection(id, 'failed');
              setError('Could not connect directly. A TURN server may be required for this network.');
            });
        } else {
          updatePeerConnection(id, 'failed');
          setError('Could not connect directly. A TURN server may be required for this network.');
        }
      }
    };

    setPeers((current) => ({
      ...current,
      [id]: { name, stream: null, audio, video, connection: 'connecting' },
    }));
    return peer;
  }, [socket, updatePeerStream, updatePeerConnection]);

  const clearTrackListeners = useCallback(() => {
    trackCleanupRef.current.forEach((cleanup) => cleanup());
    trackCleanupRef.current = [];
  }, []);

  const reportCallError = useCallback((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!mountedRef.current) return;
    setError(`Call ended: ${message}`);
    setStopReason(`Call ended: ${message}`);
  }, []);

  const leaveCall = useCallback((reason = null) => {
    const wasInCall = isInCallRef.current;
    const hasResources = wasInCall || localStreamRef.current || peerConnections.current.size > 0;
    if (!hasResources) return;

    if (wasInCall) socket.emit('video-leave');
    clearTrackListeners();

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    localStreamRef.current = null;

    peerConnections.current.forEach((_, id) => {
      closePeer(id);
    });

    isInCallRef.current = false;
    if (!mountedRef.current) return;
    setLocalStream(null);
    setPeers({});
    setMicOn(true);
    setCamOn(true);
    setStatus('idle');
    setError(reason);
    if (reason) setStopReason(reason);
  }, [socket, closePeer, clearTrackListeners]);

  useEffect(() => {
    leaveCallRef.current = leaveCall;
  }, [leaveCall]);

  const joinCall = useCallback(async () => {
    if (isInCallRef.current) return;
    setStatus('starting');
    setError(null);
    setStopReason(null);

    let iceServers = DEFAULT_ICE_SERVERS;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch('/api/ice-config', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          iceServers = data.iceServers;
        }
      }
    } catch {
      iceServers = DEFAULT_ICE_SERVERS;
    }

    iceServersRef.current = iceServers;

    let stream;
    let videoTrackFailed = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
      });
    } catch {
      videoTrackFailed = true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch (err2) {
        setError(humanErrorMessage(err2));
        setStatus('idle');
        return;
      }
    }

    if (videoTrackFailed) {
      setCamOn(false);
    }

    localStreamRef.current = stream;
    clearTrackListeners();
    stream.getTracks().forEach((track) => {
      const onEnded = () => {
        if (isInCallRef.current) {
          leaveCallRef.current?.('Camera stopped: another app or tab took the device');
        }
      };
      track.addEventListener('ended', onEnded);
      trackCleanupRef.current.push(() => track.removeEventListener('ended', onEnded));
    });
    setLocalStream(stream);
    setMicOn(true);
    setCamOn(stream.getVideoTracks().length > 0);
    setStatus('in-call');
    isInCallRef.current = true;

    try {
      socket.emit('video-join', {
        audio: stream.getAudioTracks().length > 0,
        video: stream.getVideoTracks().length > 0,
      });

      participantsRef.current.forEach((participant) => {
        if (participant.id === socket.id) return;
        createPeer(participant.id, participant.name, participant.audio || false, participant.video || false, true);
      });
    } catch (error) {
      reportCallError(error);
    }
  }, [socket, createPeer, clearTrackListeners, reportCallError]);

  const toggleMic = useCallback(() => {
    const next = !micOn;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicOn(next);
    socket.emit('video-state', { audio: next, video: camOn });
  }, [micOn, camOn, socket]);

  const toggleCam = useCallback(() => {
    const next = !camOn;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCamOn(next);
    socket.emit('video-state', { audio: micOn, video: next });
  }, [camOn, micOn, socket]);

  // ----- Socket event handlers -----
  useEffect(() => {
    if (!socket) return undefined;

    const onVideoPeers = (peerList) => {
      if (!Array.isArray(peerList)) return;
      peerList.forEach((peer) => {
        if (peer.id === socket.id) return;
        try {
          createPeer(peer.id, peer.name, peer.audio || false, peer.video || false, true);
        } catch (error) {
          reportCallError(error);
        }
      });
    };

    const onVideoPeerJoined = (payload) => {
      if (!payload || typeof payload !== 'object') return;
      setPeers((current) => {
        if (current[payload.id]) return current;
        return { ...current, [payload.id]: { name: payload.name || '', stream: null, audio: !!payload.audio, video: !!payload.video, connection: 'connecting' } };
      });
    };

    const onVideoPeerLeft = (payload) => {
      if (!payload || typeof payload !== 'object' || !payload.id) return;
      closePeer(payload.id);
    };

    const onVideoPeerState = (payload) => {
      if (!payload || typeof payload !== 'object' || !payload.id) return;
      if (typeof payload.audio === 'boolean') updatePeerFlag(payload.id, 'audio', payload.audio);
      if (typeof payload.video === 'boolean') updatePeerFlag(payload.id, 'video', payload.video);
    };

    const onVideoOffer = (payload) => {
      if (!payload || typeof payload !== 'object' || !payload.fromId || !payload.offer) return;
      const { fromId, offer } = payload;
      if (peerConnections.current.has(fromId)) {
        const peer = peerConnections.current.get(fromId);
        peer.setRemoteDescription(offer)
          .then(() => peer.createAnswer())
          .then((answer) => peer.setLocalDescription(answer).then(() => answer))
          .then((answer) => {
            socket.emit('video-answer', { targetId: fromId, answer });
          })
          .catch((error) => {
            closePeer(fromId);
            reportCallError(error);
          });
        return;
      }
      const existing = peersRef.current[fromId];
      const peer = createPeer(fromId, existing ? existing.name : '', existing ? existing.audio : false, existing ? existing.video : false, false);
      if (!peer) return;
      peer.setRemoteDescription(offer)
        .then(() => peer.createAnswer())
        .then((answer) => peer.setLocalDescription(answer).then(() => answer))
        .then((answer) => {
          socket.emit('video-answer', { targetId: fromId, answer });
        })
        .catch((error) => {
          closePeer(fromId);
          reportCallError(error);
        });
    };

    const onVideoAnswer = (payload) => {
      if (!payload || typeof payload !== 'object' || !payload.fromId || !payload.answer) return;
      const peer = peerConnections.current.get(payload.fromId);
      if (!peer) return;
      remoteDescriptionsSet.current.add(payload.fromId);
      peer.setRemoteDescription(payload.answer).catch((error) => {
        closePeer(payload.fromId);
        reportCallError(error);
      });
    };

    const onVideoIceCandidate = (payload) => {
      if (!payload || typeof payload !== 'object' || !payload.fromId || !payload.candidate) return;
      addQueuedCandidate(payload.fromId, payload.candidate);
    };

    const onSocketConnect = () => {
      if (!isInCallRef.current) return;
      peerConnections.current.forEach((_, id) => {
        closePeer(id);
      });
      setPeers({});
      setTimeout(() => {
        socket.emit('video-join', { audio: micOnRef.current, video: camOnRef.current });
      }, 0);
    };

    socket.on('video-peers', onVideoPeers);
    socket.on('video-peer-joined', onVideoPeerJoined);
    socket.on('video-peer-left', onVideoPeerLeft);
    socket.on('video-peer-state', onVideoPeerState);
    socket.on('video-offer', onVideoOffer);
    socket.on('video-answer', onVideoAnswer);
    socket.on('video-ice-candidate', onVideoIceCandidate);
    socket.on('connect', onSocketConnect);

    return () => {
      socket.off('video-peers', onVideoPeers);
      socket.off('video-peer-joined', onVideoPeerJoined);
      socket.off('video-peer-left', onVideoPeerLeft);
      socket.off('video-peer-state', onVideoPeerState);
      socket.off('video-offer', onVideoOffer);
      socket.off('video-answer', onVideoAnswer);
      socket.off('video-ice-candidate', onVideoIceCandidate);
      socket.off('connect', onSocketConnect);
    };
  }, [socket, createPeer, closePeer, updatePeerFlag, addQueuedCandidate, reportCallError]);

  // ----- Lifecycle: auto-leave only on actual hook unmount -----
  useEffect(() => {
    mountedRef.current = true;
    const timers = iceRestartTimers.current;
    return () => {
      mountedRef.current = false;
      leaveCallRef.current?.();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return {
    status,
    error,
    stopReason,
    localStream,
    micOn,
    camOn,
    peers,
    joinCall,
    leaveCall,
    toggleMic,
    toggleCam,
  };
}