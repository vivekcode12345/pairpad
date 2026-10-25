import { useCallback, useEffect, useRef, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import { MonacoBinding } from 'y-monaco';
import { createSession } from './yjsProvider';
import { isDefaultTemplate, LANGUAGES, TEMPLATES } from './templates';
import socket from './socket';
import { updateRemoteCursorStyles, removeRemoteCursorStyles } from './remoteCursors';
import { Avatar, Button, IconButton, Logo, Select, Splitter, useToast } from './components/ui';
import { CopyIcon, MenuIcon, PlayIcon } from './components/Icons';
import './styles/room.css';
import './monacoSetup';

function statusFor(socketConnected) {
  return socketConnected ? { label: 'Connected', className: '' } : { label: 'Reconnecting', className: 'reconnecting' };
}

export default function Room({ roomId: initialRoomId = '', initialName = '' }) {
  const params = new URLSearchParams(window.location.search);
  const [roomId] = useState(initialRoomId || params.get('room') || '');
  const [userName] = useState(initialName || params.get('name') || '');
  const [language, setLanguage] = useState('javascript');
  const [users, setUsers] = useState([]);
  const [output, setOutput] = useState('');
  const [userInput, setUserInput] = useState('');
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
  const [joined, setJoined] = useState(false);
  const [panel, setPanel] = useState('input');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('room-sidebar-collapsed') === '1');
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
    const onLanguage = (next) => setLanguage(next);
    const onRunning = () => { setRunning(true); setOutput('Running...'); setPanel('output'); };
    const onResponse = (response) => { setRunning(false); setOutput(response.run?.output ?? ''); setPanel('output'); };
    const onConnect = () => { setConnected(true); if (joinInfo.current) socket.emit('join', joinInfo.current); };
    const onDisconnect = () => setConnected(false);
    socket.on('user-joined', onJoined);
    socket.on('user-Left', onLeft);
    socket.on('languageChange', onLanguage);
    socket.on('codeRunning', onRunning);
    socket.on('codeResponse', onResponse);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('user-joined', onJoined); socket.off('user-Left', onLeft);
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

  if (!joined) return <div className="cc-room"><div className="cc-room-topbar"><Logo /></div><div className="cc-empty-output">Enter a name and room ID to join.</div></div>;
  const connection = statusFor(connected);
  return <main className="cc-room">
    <header className="cc-room-topbar">
      <IconButton label="Toggle people sidebar" onClick={() => setSidebarCollapsed((value) => !value)}><MenuIcon /></IconButton>
      <Logo /><div className="cc-room-chip">{roomId}</div>
      <Button size="small" variant="ghost" onClick={() => copy(roomId, 'ID copied')}><CopyIcon /> Copy ID</Button>
      <Button size="small" variant="ghost" onClick={() => copy(`${window.location.origin}/?replay=${encodeURIComponent(roomId)}`, 'Link copied')}>Copy replay link</Button>
      <div className="cc-top-spacer" /><div className="cc-connection"><span className={`cc-status-dot ${connection.className}`} />{connection.label}</div><Button size="small" variant="danger" onClick={leaveRoom}>Leave</Button>
    </header>
    <div className="cc-room-body">
      <aside className={`cc-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}><h2>People ({users.length})</h2><div className="cc-people">{users.length ? users.map((name, index) => <div className="cc-person" key={`${name}-${index}`}><Avatar name={name} /><span>{name} {name === userName && <small className="cc-you">(you)</small>}</span></div>) : <p className="cc-empty">No one else is here yet.</p>}</div></aside>
      <section className="cc-workspace">
        <div className="cc-editor-toolbar"><Select label="" className="cc-toolbar-select" value={language} onChange={handleLanguageChange}>{LANGUAGES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</Select><div className="cc-top-spacer" /><Button variant="primary" loading={running} onClick={runCode}><PlayIcon /> Run&nbsp; ⌘/Ctrl ↵</Button></div>
        <div className="cc-editor"><Editor height="100%" language={language} theme="cc-light" options={{ minimap: { enabled: false }, fontFamily: 'var(--font-mono)', fontSize: 14, fontLigatures: true, smoothScrolling: true, cursorSmoothCaretAnimation: 'on', padding: { top: 12, bottom: 12 }, scrollBeyondLastLine: false, renderLineHighlight: 'all', bracketPairColorization: { enabled: true }, automaticLayout: true }} onMount={(editor) => {
          editorRef.current = editor; editor.onDidChangeCursorPosition((event) => setCursorPosition(event.position));
          const session = sessionRef.current; if (!session || bindingRef.current) return;
          bindingRef.current = new MonacoBinding(session.ytext, editor.getModel(), new Set([editor]), session.awareness);
          refreshRemoteCursorStyles();
        }} /></div>
        <Splitter direction="horizontal" size={panelSize} onChange={setPanelSize} onReset={() => setPanelSize(30)} />
        <div className="cc-bottom-panel" style={{ height: `${panelSize}%` }}><div className="cc-panel-tabs"><button className={`cc-tab ${panel === 'input' ? 'active' : ''}`} onClick={() => setPanel('input')}>Input</button><button className={`cc-tab ${panel === 'output' ? 'active' : ''}`} onClick={() => setPanel('output')}>Output</button><div className="cc-top-spacer" />{panel === 'output' && <Button size="small" variant="ghost" onClick={() => setOutput('')}>Clear</Button>}</div><div className="cc-panel-content">{panel === 'input' ? <textarea className="cc-textarea" aria-label="Standard input" value={userInput} onChange={(e) => setUserInput(e.target.value)} placeholder="Enter input for your program..." /> : output ? <pre className="cc-output">{output}</pre> : <div className="cc-empty-output">Run your code to see output here</div>}</div></div>
        <footer className="cc-statusbar"><span>{language}</span><span>Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}</span><span className="cc-statusbar-spacer" /><span>{users.length} people</span><span>{connection.label}</span></footer>
      </section>
    </div>
  </main>;
}
