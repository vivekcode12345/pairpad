import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, Button, IconButton } from './ui';
import { MicIcon, PhoneOffIcon, VideoIcon } from './Icons';

const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function VideoTile({ name, stream, muted = false, local = false, videoEnabled = true }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null;
  }, [stream, videoEnabled]);

  return (
    <div className={`cc-video-tile${local ? ' local' : ''}`}>
      {stream && videoEnabled ? (
        <video ref={videoRef} autoPlay muted={muted} playsInline />
      ) : (
        <Avatar name={name} />
      )}
      <span>{name}{local ? ' (you)' : ''}</span>
    </div>
  );
}

export default function VideoRoom({ socket, userName, participants }) {
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const peersRef = useRef(new Map());
  const participantsRef = useRef(participants);
  const localStreamRef = useRef(null);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  const closePeer = useCallback((id) => {
    peersRef.current.get(id)?.close();
    peersRef.current.delete(id);
    setRemoteStreams((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const createPeer = useCallback((participant, initiator) => {
    if (!localStreamRef.current || participant.id === socket.id) return null;
    const existing = peersRef.current.get(participant.id);
    if (existing) return existing;

    const peer = new RTCPeerConnection(RTC_CONFIG);
    localStreamRef.current.getTracks().forEach((track) => peer.addTrack(track, localStreamRef.current));
    peer.onicecandidate = (event) => {
      if (event.candidate) socket.emit('video-ice-candidate', { targetId: participant.id, candidate: event.candidate });
    };
    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) setRemoteStreams((current) => ({ ...current, [participant.id]: stream }));
    };
    peer.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) closePeer(participant.id);
    };
    peersRef.current.set(participant.id, peer);
    if (initiator) {
      peer.createOffer()
        .then((offer) => peer.setLocalDescription(offer).then(() => {
          socket.emit('video-offer', { targetId: participant.id, offer });
        }))
        .catch(() => closePeer(participant.id));
    }
    return peer;
  }, [closePeer, socket]);

  const enableVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setEnabled(true);
      setMuted(false);
      setVideoEnabled(true);
      participantsRef.current
        .filter((participant) => participant.id !== socket.id && socket.id < participant.id)
        .forEach((participant) => createPeer(participant, true));
    } catch (error) {
      setEnabled(false);
      console.error('Could not access camera and microphone:', error);
    }
  };

  useEffect(() => {
    const onParticipants = () => {
      if (!localStreamRef.current) return;
      participantsRef.current
        .filter((participant) => participant.id !== socket.id && socket.id < participant.id)
        .forEach((participant) => createPeer(participant, true));
    };
    const onOffer = async ({ fromId, offer }) => {
      const participant = participantsRef.current.find((item) => item.id === fromId);
      if (!participant || !localStreamRef.current) return;
      const peer = createPeer(participant, false);
      await peer.setRemoteDescription(offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('video-answer', { targetId: fromId, answer });
    };
    const onAnswer = ({ fromId, answer }) => peersRef.current.get(fromId)?.setRemoteDescription(answer).catch(() => {});
    const onCandidate = ({ fromId, candidate }) => peersRef.current.get(fromId)?.addIceCandidate(candidate).catch(() => {});
    const onLeft = (names) => {
      const currentIds = new Set(participantsRef.current.map((participant) => participant.id));
      peersRef.current.forEach((_, id) => {
        if (!currentIds.has(id)) closePeer(id);
      });
      if (!names.length) setRemoteStreams({});
    };
    socket.on('room-participants', onParticipants);
    socket.on('video-offer', onOffer);
    socket.on('video-answer', onAnswer);
    socket.on('video-ice-candidate', onCandidate);
    socket.on('user-Left', onLeft);
    return () => {
      socket.off('room-participants', onParticipants);
      socket.off('video-offer', onOffer);
      socket.off('video-answer', onAnswer);
      socket.off('video-ice-candidate', onCandidate);
      socket.off('user-Left', onLeft);
    };
  }, [closePeer, createPeer, socket]);

  useEffect(() => () => {
    peersRef.current.forEach((peer) => peer.close());
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const toggleMute = () => {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  };

  const toggleVideo = () => {
    const next = !videoEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setVideoEnabled(next);
  };

  const leaveCall = () => {
    peersRef.current.forEach((peer) => peer.close());
    peersRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStreams({});
    setEnabled(false);
    setMuted(false);
    setVideoEnabled(true);
  };

  return (
    <section className="cc-video-room">
      <div className="cc-video-heading">
        <h2>Video room</h2>
        <span>{enabled ? 'Live' : 'Off'}</span>
      </div>
      <div className="cc-video-grid">
        {enabled && <VideoTile name={userName} stream={localStream} muted local videoEnabled={videoEnabled} />}
        {participants.filter((participant) => participant.id !== socket.id).map((participant) => (
          <VideoTile key={participant.id} name={participant.name} stream={remoteStreams[participant.id]} />
        ))}
      </div>
      <div className="cc-video-actions">
        {!enabled ? (
          <Button size="small" variant="primary" onClick={enableVideo}>Enable video</Button>
        ) : (
          <div className="cc-call-controls" role="group" aria-label="Call controls">
            <IconButton className={muted ? 'active' : ''} label={muted ? 'Unmute microphone' : 'Mute microphone'} onClick={toggleMute}>
              <MicIcon />
            </IconButton>
            <IconButton className={!videoEnabled ? 'active' : ''} label={videoEnabled ? 'Turn off camera' : 'Turn on camera'} onClick={toggleVideo}>
              <VideoIcon />
            </IconButton>
            <IconButton className="hangup" label="Leave call" onClick={leaveCall}>
              <PhoneOffIcon />
            </IconButton>
          </div>
        )}
      </div>
    </section>
  );
}
