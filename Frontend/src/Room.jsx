import { useCallback, useEffect, useRef, useState } from 'react';
import { MonacoBinding } from 'y-monaco';
import { createSession } from './yjsProvider';
import { isDefaultTemplate, LANGUAGES, TEMPLATES } from './templates';
import socket from './socket';
import { updateRemoteCursorStyles, removeRemoteCursorStyles } from './remoteCursors';
import { Button, HomeLink, IconButton, useToast } from './components/ui';
import { CloseIcon, CopyIcon, MenuIcon } from './components/Icons';
import RoomSidebar from './components/RoomSidebar';
import RoomWorkspace from './components/RoomWorkspace';
import './styles/room.css';
import './monacoSetup';

function statusFor(socketConnected) {
  return socketConnected ? { label: 'Connected', className: '' } : { label: 'Reconnecting', className: 'reconnecting' };
}

export default function Room({ roomId: initialRoomId = '', initialName = '' }) {
  const params = new URLSearchParams(window.location.search);
  const [roomId] = useState(initialRoomId || params.get('room') || '');
  const [userName] = useState(initialName || params.get('name') || '');
  const [language, setLanguage] = useState('python');
  const [users, setUsers] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [output, setOutput] = useState('');
  const [userInput, setUserInput] = useState('');
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
  const [joined, setJoined] = useState(false);
  const [panel, setPanel] = useState('input');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('room-sidebar-collapsed') === '1');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const drawerButtonRef = useRef(null);
  const drawerWasOpen = useRef(false);
  const [panelSize, setPanelSize] = useState(() => Number(localStorage.getItem('room-panel-size')) || 30);
  const [cursorPosition, setCursorPosition] = useState({ lineNumber: 1, column: 1 });
  const sessionRef = useRef(null);
  const bindingRef = useRef(null);
  const joinInfo = useRef(null);
  const editorRef = useRef(null);
  const initialUsers = useRef(true);
  const { toast } = useToast();
  const refreshRemoteCursorStyles = useCallback(() => updateRemoteCursorStyles(sessionRef.current), []);

  const notifyUserDiff = useCallback((nextUsers) => {
    const previous = usersRef.current;
    if (!initialUsers.current) {
      nextUsers.filter((name) => !previous.includes(name) && name !== userName).forEach((name) => toast(`${name} joined`));
      previous.filter((name) => !nextUsers.includes(name) && name !== userName).forEach((name) => toast(`${name} left`));
    }
    initialUsers.current = false;
    usersRef.current = nextUsers;
    setUsers(nextUsers);
  }, [toast, userName]);
  const usersRef = useRef([]);

  useEffect(() => {
    const onJoined = (list) => notifyUserDiff(list);
    const onLeft = (list) => notifyUserDiff(list);
    const onParticipants = (list) => setParticipants(Array.isArray(list) ? list : []);
    const onLanguage = (next) => setLanguage(next);
    const onRunning = () => { setRunning(true); setOutput('Running...'); setPanel('output'); };
    const onResponse = (response) => { setRunning(false); setOutput(response.run?.output ?? ''); setPanel('output'); };
    const onConnect = () => { setConnected(true); if (joinInfo.current) socket.emit('join', joinInfo.current); };
    const onDisconnect = () => setConnected(false);
    socket.on('user-joined', onJoined);
    socket.on('user-Left', onLeft);
    socket.on('room-participants', onParticipants);
    socket.on('languageChange', onLanguage);
    socket.on('codeRunning', onRunning);
    socket.on('codeResponse', onResponse);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('user-joined', onJoined); socket.off('user-Left', onLeft);
      socket.off('room-participants', onParticipants);
      socket.off('languageChange', onLanguage); socket.off('codeRunning', onRunning);
      socket.off('codeResponse', onResponse); socket.off('connect', onConnect); socket.off('disconnect', onDisconnect);
      removeRemoteCursorStyles();
    };
  }, [notifyUserDiff]);

  const joinRoom = useCallback(() => {
    if (!roomId || !userName) return;
    const info = { roomId, userName };
    joinInfo.current = info;
    sessionRef.current = createSession(socket, userName);
    sessionRef.current.awareness.on('change', refreshRemoteCursorStyles);
    socket.emit('join', info);
    setJoined(true);
  }, [refreshRemoteCursorStyles, roomId, userName]);

  useEffect(() => {
    if (!roomId || !userName) return undefined;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) joinRoom(); });
    return () => { cancelled = true; };
  }, [joinRoom, roomId, userName]);

  const leaveRoom = () => {
    socket.emit('leave-room');
    setJoined(false);
    joinInfo.current = null;
    if (bindingRef.current) { bindingRef.current.destroy(); bindingRef.current = null; }
    if (sessionRef.current) { sessionRef.current.awareness.off('change', refreshRemoteCursorStyles); sessionRef.current.destroy(); sessionRef.current = null; }
    removeRemoteCursorStyles();
    window.location.href = '/';
  };
  const copy = async (value, message) => { await navigator.clipboard.writeText(value); toast(message); };
  const handleLanguageChange = (event) => {
    const next = event.target.value;
    setLanguage(next);
    const session = sessionRef.current;
    if (session && isDefaultTemplate(session.ytext.toString())) {
      session.doc.transact(() => { session.ytext.delete(0, session.ytext.length); session.ytext.insert(0, TEMPLATES[next] || '// Start your code here'); });
    }
    socket.emit('languageChange', { language: next });
  };
  const runCode = () => { if (!running) socket.emit('compileCode', { language, input: userInput }); };
  useEffect(() => {
    const onKey = (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); runCode(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    localStorage.setItem('room-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
    localStorage.setItem('room-panel-size', String(panelSize));
  }, [panelSize, sidebarCollapsed]);
  useEffect(() => {
    const layout = () => editorRef.current?.layout();
    window.addEventListener('orientationchange', layout);
    window.visualViewport?.addEventListener('resize', layout);
    return () => {
      window.removeEventListener('orientationchange', layout);
      window.visualViewport?.removeEventListener('resize', layout);
    };
  }, []);

  const handleEditorMount = (editor) => {
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((event) => setCursorPosition(event.position));
    const session = sessionRef.current;
    if (!session || bindingRef.current) return;
    bindingRef.current = new MonacoBinding(session.ytext, editor.getModel(), new Set([editor]), session.awareness);
    refreshRemoteCursorStyles();
  };

  useEffect(() => {
    if (!mobileSidebarOpen) {
      if (drawerWasOpen.current && window.matchMedia('(max-width: 820px)').matches) {
        drawerButtonRef.current?.focus();
      }
      drawerWasOpen.current = false;
      return undefined;
    }
    drawerWasOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    const close = (event) => {
      if (event.key === 'Escape') setMobileSidebarOpen(false);
      if (event.key !== 'Tab') return;
      const drawer = document.getElementById('room-sidebar');
      const focusable = drawer ? [...drawer.querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.disabled) : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', close);
    document.getElementById('room-sidebar')?.querySelector('button, a, input, select, textarea')?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', close);
    };
  }, [mobileSidebarOpen]);
  if (!joined) return <div className="cc-room"><div className="cc-room-topbar"><HomeLink /></div><div className="cc-empty-output">Enter a name and room ID to join.</div></div>;
  const connection = statusFor(connected);
  return <main className="cc-room">
    <header className="cc-room-topbar">
      <IconButton ref={drawerButtonRef} className="cc-room-menu-button" label={mobileSidebarOpen ? 'Close people drawer' : 'Open people drawer'} aria-expanded={mobileSidebarOpen} aria-controls="room-sidebar" onClick={() => {
        if (window.matchMedia('(max-width: 820px)').matches) setMobileSidebarOpen((value) => !value);
        else setSidebarCollapsed((value) => !value);
      }}>{mobileSidebarOpen ? <CloseIcon /> : <MenuIcon />}</IconButton>
      <HomeLink /><div className="cc-room-chip">{roomId}</div>
      <Button className="cc-room-copy-id" size="small" variant="ghost" onClick={() => copy(roomId, 'ID copied')}><CopyIcon /> Copy ID</Button>
      <Button className="cc-room-copy-replay" size="small" variant="ghost" onClick={() => copy(`${window.location.origin}/?replay=${encodeURIComponent(roomId)}`, 'Link copied')}>Copy replay link</Button>
      <div className="cc-top-spacer" /><div className="cc-connection"><span className={`cc-status-dot ${connection.className}`} />{connection.label}</div><Button className="cc-room-leave" size="small" variant="danger" onClick={leaveRoom}>Leave</Button>
    </header>
    <div className="cc-room-body">
      {mobileSidebarOpen && <button className="cc-room-backdrop" aria-label="Close people drawer" onClick={() => setMobileSidebarOpen(false)} />}
      <RoomSidebar collapsed={sidebarCollapsed} mobileOpen={mobileSidebarOpen} socket={socket} userName={userName} participants={participants} users={users} />
      <RoomWorkspace
        language={language}
        languages={LANGUAGES}
        onLanguageChange={handleLanguageChange}
        running={running}
        onRun={runCode}
        editorMount={handleEditorMount}
        panelSize={panelSize}
        onPanelSizeChange={setPanelSize}
        onPanelReset={() => setPanelSize(30)}
        panel={panel}
        onPanelChange={setPanel}
        output={output}
        onClearOutput={() => setOutput('')}
        userInput={userInput}
        onUserInputChange={(event) => setUserInput(event.target.value)}
        cursorPosition={cursorPosition}
        peopleCount={users.length}
        connection={connection}
      />
    </div>
  </main>;
}
