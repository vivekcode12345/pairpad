import Replay from './Replay';
import Interview from './Interview';
import Home from './Home';
import Room from './Room';
import { ToastProvider } from './components/ui';
import './App.css';

function AppRouter() {
  const params = new URLSearchParams(window.location.search);
  const replayRoomId = params.get('replay');
  const interviewRoomId = params.get('interview');
  const roomId = params.get('room');
  const name = params.get('name');
  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
  }, []);
  if (replayRoomId) return <Replay roomId={replayRoomId} />;
  if (interviewRoomId) return <Interview roomId={interviewRoomId} />;
  if (roomId && name) return <Room roomId={roomId} initialName={name} />;
  return <Home />;
}

export default function App() {
  return <ToastProvider><AppRouter /></ToastProvider>;
}
import { useEffect } from 'react';
