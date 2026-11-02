import { useCallback } from 'react';
import { Avatar, Button, IconButton } from './ui';
import { MicIcon, MicOffIcon, PhoneOffIcon, VideoIcon } from './Icons';
import { useCall } from '../hooks/useCall';

function VideoTile({ name, stream, muted = false, local = false, videoEnabled = true, connection = 'connected', audioEnabled = true }) {
  const setVideoRef = useCallback((node) => {
    if (node) node.srcObject = stream || null;
  }, [stream]);

  const showVideo = stream && videoEnabled && connection !== 'failed';

  return (
    <div className={`cc-video-tile${local ? ' local' : ''}`}>
      {showVideo ? (
        <video ref={setVideoRef} autoPlay muted={muted} playsInline />
      ) : (
        <Avatar name={name} />
      )}
      <span>{name}{local ? ' (you)' : ''}</span>
      {connection === 'reconnecting' && <span className="cc-video-status">Reconnecting…</span>}
      {connection === 'failed' && <span className="cc-video-status">Failed</span>}
      {!audioEnabled && <span className="cc-video-status">🔇</span>}
      {!videoEnabled && !showVideo && <span className="cc-video-status">📷</span>}
    </div>
  );
}

export default function VideoRoom({ socket, userName, participants }) {
  const { status, error, localStream, micOn, camOn, peers, joinCall, leaveCall, toggleMic, toggleCam } = useCall({
    socket,
    userName,
    participants,
  });

  const handleLeave = useCallback(() => {
    leaveCall();
  }, [leaveCall]);

  return (
    <section className="cc-video-room">
      <div className="cc-video-heading">
        <h2>Video room</h2>
        <span>{status === 'in-call' ? 'Live' : status === 'starting' ? 'Starting…' : 'Off'}</span>
      </div>
      <div className="cc-video-grid">
        {status === 'in-call' && <VideoTile
          name={userName}
          stream={localStream}
          muted
          local
          videoEnabled={camOn}
          connection="connected"
          audioEnabled={micOn}
        />}
        {Object.entries(peers).map(([id, peer]) => (
          <VideoTile
            key={id}
            name={peer.name}
            stream={peer.stream}
            videoEnabled={peer.video}
            connection={peer.connection}
            audioEnabled={peer.audio}
          />
        ))}
      </div>
      {error && <div className="cc-video-error">{error}</div>}
      <div className="cc-video-actions">
        {status === 'idle' ? (
          <Button size="small" variant="primary" onClick={joinCall}>Join call</Button>
        ) : (
          <div className="cc-call-controls" role="group" aria-label="Call controls">
            <IconButton className={!micOn ? 'active' : ''} label={!micOn ? 'Unmute microphone' : 'Mute microphone'} onClick={toggleMic}>
              {!micOn ? <MicOffIcon /> : <MicIcon />}
            </IconButton>
            <IconButton className={!camOn ? 'active' : ''} label={!camOn ? 'Turn on camera' : 'Turn off camera'} onClick={toggleCam}>
              <VideoIcon />
            </IconButton>
            <IconButton className="hangup" label="Leave call" onClick={handleLeave}>
              <PhoneOffIcon />
            </IconButton>
          </div>
        )}
      </div>
    </section>
  );
}
