import { useEffect, useRef, useState } from 'react';
import { Button, Card, Input } from './components/ui';
import HeroPreview from './components/HeroPreview';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import CtaBand from './components/CtaBand';
import socket from './socket';
import Navbar from './components/Navbar';
import './styles/home.css';

const GITHUB_URL = import.meta.env.VITE_GITHUB_URL?.trim() || 'https://github.com/vivekcode12345';

export default function Home() {
  const params = new URLSearchParams(window.location.search);
  const [roomId, setRoomId] = useState(params.get('room') || '');
  const [name, setName] = useState('');
  const [interviewName, setInterviewName] = useState('');
  const [replayRoom, setReplayRoom] = useState('');
  const [joinTried, setJoinTried] = useState(false);
  const [interviewTried, setInterviewTried] = useState(false);
  const [replayTried, setReplayTried] = useState(false);
  const [interviewError, setInterviewError] = useState('');
  const nameRef = useRef(null);
  const interviewNameRef = useRef(null);
  const replayNameRef = useRef(null);
  const demoSectionRef = useRef(null);
  const startSectionRef = useRef(null);
  const featuresSectionRef = useRef(null);
  const howSectionRef = useRef(null);
  const joinHeadingRef = useRef(null);
  const interviewHeadingRef = useRef(null);
  const replayHeadingRef = useRef(null);
  const sectionRefs = {
    demo: demoSectionRef,
    start: startSectionRef,
    features: featuresSectionRef,
    how: howSectionRef,
    interview: interviewHeadingRef,
    replay: replayHeadingRef,
    join: joinHeadingRef,
  };

  const presetRoom = params.get('room');
  useEffect(() => {
    if (presetRoom) nameRef.current?.focus();
  }, [presetRoom]);

  const createRoomId = () => setRoomId(Math.random().toString(36).substring(2, 10));
  const join = (event) => {
    event.preventDefault();
    setJoinTried(true);
    if (!roomId.trim() || !name.trim()) return;
    window.location.href = `/?room=${encodeURIComponent(roomId.trim())}&name=${encodeURIComponent(name.trim())}`;
  };
  const createInterview = (event) => {
    event.preventDefault();
    setInterviewTried(true);
    const userName = interviewName.trim();
    if (!userName) return;
    setInterviewError('');
    socket.emit('create-interview', { userName }, (ack) => {
      if (!ack?.ok) {
        setInterviewError(ack?.error || 'Could not create interview.');
        return;
      }
      localStorage.setItem(`interview-key:${ack.roomId}`, ack.interviewerKey);
      localStorage.setItem(`interview-name:${ack.roomId}`, userName);
      window.location.href = `/?interview=${encodeURIComponent(ack.roomId)}`;
    });
  };
  const watch = (event) => {
    event.preventDefault();
    setReplayTried(true);
    if (replayRoom.trim()) window.location.href = `/?replay=${encodeURIComponent(replayRoom.trim())}`;
  };

  return <main className="cc-home" id="main-content">
    <div className="cc-home-inner">
      <Navbar onGenerate={createRoomId} focusName={(id) => (id === 'join' ? nameRef : id === 'interview' ? interviewNameRef : replayNameRef).current?.focus()} sectionRefs={sectionRefs} />
      <div className="cc-navbar-spacer" aria-hidden="true" />
      <section className="cc-hero">
        <div className="cc-hero-copy"><h1 id="demo" ref={demoSectionRef} tabIndex="-1">Code together.<br /><span>Interview better.</span></h1><p>Real-time collaborative editor with live cursors, sandboxed execution, session replay and interview mode.</p></div>
        <HeroPreview />
      </section>
      <section className="cc-home-grid" id="start" ref={startSectionRef} tabIndex="-1">
        <Card className="cc-home-card cc-home-card-join">
          <div className="cc-card-intro"><h2 id="join" ref={joinHeadingRef} tabIndex="-1">Join or create a room</h2><p>Collaborate in a shared live coding room.</p></div>
          <form className="cc-card-form" onSubmit={join}>
            <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} ref={nameRef} placeholder="Ada Lovelace" error={joinTried && !name.trim() ? 'Enter your name' : undefined} />
            <div className="cc-room-id-row"><Input label="Room ID" value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="room-id" error={joinTried && !roomId.trim() ? 'Enter a room ID' : undefined} /><Button type="button" size="small" onClick={createRoomId}>Generate</Button></div>
            <Button variant="primary" type="submit">Join room</Button>
          </form>
        </Card>
        <Card className="cc-home-card cc-home-card-secondary">
          <div className="cc-card-intro"><h2 id="interview" ref={interviewHeadingRef} tabIndex="-1">Start an interview</h2><p>Set up a structured coding interview with a private candidate link.</p></div>
          <form className="cc-card-form cc-compact-form" onSubmit={createInterview}>
            <Input label="Your name" value={interviewName} onChange={(e) => { setInterviewName(e.target.value); setInterviewError(''); }} ref={interviewNameRef} placeholder="Interviewer name" error={interviewTried && !interviewName.trim() ? 'Enter your name' : undefined} />
            {interviewError && <span className="cc-field-error">{interviewError}</span>}<Button variant="primary" type="submit">Create interview</Button>
          </form>
        </Card>
        <Card className="cc-home-card cc-home-card-secondary">
          <div className="cc-card-intro"><h2 id="replay" ref={replayHeadingRef} tabIndex="-1">Watch a replay</h2><p>Review a completed coding session from its room ID.</p></div>
          <form className="cc-card-form cc-compact-form" onSubmit={watch}>
            <Input label="Room ID" value={replayRoom} onChange={(e) => setReplayRoom(e.target.value)} ref={replayNameRef} placeholder="room-id" error={replayTried && !replayRoom.trim() ? 'Enter a room ID' : undefined} />
            <Button variant="primary" type="submit">Watch replay</Button>
          </form>
        </Card>
      </section>
      <Features sectionRef={featuresSectionRef} />
      <HowItWorks sectionRef={howSectionRef} />
      <CtaBand sectionRefs={sectionRefs} focusName={(id) => (id === 'join' ? nameRef : interviewNameRef).current?.focus()} />
      <footer className="cc-footer">
        <div className="cc-footer-main">
          <div className="cc-footer-brand"><img className="cc-footer-logo" src="/logo.png" alt="" /><div><strong>PairPad</strong><span>Code together. Interview better.</span></div></div>
          <nav aria-label="Footer"><a href="#demo">Demo</a><a href="#features">Features</a><a href="#how">How it works</a><a href="#start">Get started</a><a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a></nav>
        </div>
        <div className="cc-footer-bottom"><span>Built for thoughtful technical conversations.</span><span className="cc-footer-status"><i aria-hidden="true" />All systems ready</span><span>© {new Date().getFullYear()} PairPad</span></div>
      </footer>
    </div>
  </main>;
}
