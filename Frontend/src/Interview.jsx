import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import { MonacoBinding } from 'y-monaco';
import socket from './socket';
import { createSession } from './yjsProvider';
import { TEMPLATES, isDefaultTemplate } from './templates';
import { updateRemoteCursorStyles, removeRemoteCursorStyles } from './remoteCursors';
import './monacoSetup';
import './App.css';

const DURATIONS = [15, 30, 45, 60, 90];
const LANGUAGES = [
  ['javascript', 'JavaScript'], ['python', 'Python'], ['java', 'Java'], ['cpp', 'C++'],
];
const VERDICT_LABELS = {
  AC: 'Accepted',
  WA: 'Wrong Answer',
  RE: 'Runtime Error',
  CE: 'Compile Error',
  TLE: 'Time Limit',
  IE: 'Internal Error',
  skipped: 'Skipped',
};

function formatTime(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function downloadReport(report, roomId) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${roomId}.interview-report.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function storedCandidate(roomId) {
  try {
    const value = JSON.parse(sessionStorage.getItem(`candidate:${roomId}`));
    return value?.userName && value?.candidateKey ? value : null;
  } catch {
    return null;
  }
}

function Verdict({ value }) {
  return <span className={`iv-verdict v-${value}`}>{value}</span>;
}

function SubmissionDetails({ submission }) {
  if (!submission) return <p className="iv-muted">Select a submission to inspect it.</p>;
  return (
    <div className="iv-submission-details">
      <pre className="iv-code-preview">{submission.code}</pre>
      {submission.tests?.map((test) => (
        <details className="iv-test-detail" key={test.i}>
          <summary><Verdict value={test.verdict} /> Test {test.i + 1} · {test.ms}ms</summary>
          <div className="iv-hidden-detail">
            <strong>Input</strong><pre>{test.input}</pre>
            <strong>Expected</strong><pre>{test.expected}</pre>
            <strong>Actual</strong><pre>{test.actual}</pre>
          </div>
        </details>
      ))}
    </div>
  );
}

function SubmissionList({ submissions, selected, onSelect }) {
  return (
    <div className="iv-submission-list">
      {submissions.length === 0 && <p className="iv-muted">No submissions yet.</p>}
      {submissions.map((submission) => (
        <button
          type="button"
          className={`iv-submission-row${selected?.index === submission.index ? ' selected' : ''}`}
          key={submission.index}
          onClick={() => onSelect(submission)}
        >
          <span>#{submission.index + 1}</span>
          <span>{formatTime(submission.t)}</span>
          <Verdict value={submission.verdict} />
          <span>{submission.passed}/{submission.total}</span>
          <span>{submission.reason}</span>
        </button>
      ))}
    </div>
  );
}

function CandidateResults({ results }) {
  return (
    <section className="iv-results-panel">
      <h3>Results</h3>
      {results.length === 0 && <p className="iv-muted">No submissions yet.</p>}
      {results.map((result) => (
        <div className="iv-result-card" key={result.index}>
          <div className="iv-result-head">
            <Verdict value={result.verdict} />
            <strong>{VERDICT_LABELS[result.verdict] || result.verdict}</strong>
            <span>{result.passed}/{result.total} passed</span>
          </div>
          <div className="iv-test-verdicts">
            {result.tests?.map((test) => <span key={test.i}>Test {test.i + 1}: <Verdict value={test.verdict} /></span>)}
          </div>
        </div>
      ))}
    </section>
  );
}

export default function Interview({ roomId }) {
  const [state, setState] = useState(null);
  const [name, setName] = useState('');
  const [joinError, setJoinError] = useState('');
  const [ended, setEnded] = useState(null);
  const [results, setResults] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [judging, setJudging] = useState(false);
  const [rejection, setRejection] = useState('');
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [users, setUsers] = useState([]);
  const [language, setLanguage] = useState('javascript');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [copyStatus, setCopyStatus] = useState('');
  const [problemId, setProblemId] = useState('');
  const [duration, setDuration] = useState(45);
  const [joinStarted, setJoinStarted] = useState(false);
  const [reconnecting, setReconnecting] = useState(!socket.connected);
  const sessionRef = useRef(null);
  const bindingRef = useRef(null);
  const editorRef = useRef(null);
  const joinInfoRef = useRef(null);

  const interviewerKey = useMemo(() => localStorage.getItem(`interview-key:${roomId}`), [roomId]);
  const interviewerName = useMemo(() => localStorage.getItem(`interview-name:${roomId}`), [roomId]);
  const candidate = useMemo(() => storedCandidate(roomId), [roomId]);
  const isInterviewer = state?.role === 'interviewer' || !!interviewerKey;
  const status = state?.status || 'lobby';
  const userName = interviewerKey ? (interviewerName || name) : (candidate?.userName || name);
  const remaining = state?.endsAt
    ? Math.max(0, state.endsAt - (now + clockOffset))
    : null;

  const refreshCursors = useCallback(() => updateRemoteCursorStyles(sessionRef.current), []);
  const destroySession = useCallback(() => {
    bindingRef.current?.destroy();
    bindingRef.current = null;
    sessionRef.current?.destroy();
    sessionRef.current = null;
    removeRemoteCursorStyles();
  }, []);

  const join = useCallback((info) => {
    if (!info?.userName) return;
    setJoinStarted(true);
    joinInfoRef.current = info;
    if (!sessionRef.current) {
      sessionRef.current = createSession(socket, info.userName);
      sessionRef.current.awareness.on('change', refreshCursors);
    }
    socket.emit('join-interview', {
      roomId,
      userName: info.userName,
      ...(info.interviewerKey ? { interviewerKey: info.interviewerKey } : {}),
      ...(info.candidateKey ? { candidateKey: info.candidateKey } : {}),
    }, (ack) => {
      if (!ack?.ok) {
        setJoinError(ack?.error || 'Could not join interview.');
        destroySession();
        return;
      }
      if (ack.role === 'candidate' && ack.candidateKey) {
        sessionStorage.setItem(`candidate:${roomId}`, JSON.stringify({
          userName: info.userName,
          candidateKey: ack.candidateKey,
        }));
      }
      setJoinError('');
    });
  }, [destroySession, refreshCursors, roomId]);

  useEffect(() => {
    const onState = (payload) => {
      setState(payload);
      if (typeof payload?.serverNow === 'number') setClockOffset(payload.serverNow - Date.now());
      if (payload?.problem?.id) setProblemId(payload.problem.id);
    };
    const onEnded = (payload) => setEnded(payload || {});
    const onResult = (payload) => {
      if (!payload) return;
      setResults((previous) => [...previous.filter((item) => item.index !== payload.index), payload]);
      setJudging(false);
    };
    const onSubmissions = (payload) => {
      if (!isInterviewer) return;
      const next = Array.isArray(payload) ? payload : [];
      setSubmissions(next);
      setSelectedSubmission((current) => current ? next.find((item) => item.index === current.index) || current : next.at(-1));
      setJudging(false);
    };
    const onRejected = (payload) => {
      setJudging(false);
      setRejection(payload?.reason || 'Submission rejected.');
    };
    const onUsers = (list) => setUsers(Array.isArray(list) ? list : []);
    const onLanguage = (value) => setLanguage(value);
    const onRunning = () => { setRunning(true); setOutput('Running...'); };
    const onResponse = (response) => { setRunning(false); setOutput(response?.run?.output ?? ''); };
    const onConnect = () => {
      setReconnecting(false);
      if (joinInfoRef.current) join(joinInfoRef.current);
    };
    const onDisconnect = () => setReconnecting(true);
    socket.on('interview-state', onState);
    socket.on('interview-ended', onEnded);
    socket.on('submission-result', onResult);
    socket.on('interview-submissions', onSubmissions);
    socket.on('submission-rejected', onRejected);
    socket.on('user-joined', onUsers);
    socket.on('user-Left', onUsers);
    socket.on('languageChange', onLanguage);
    socket.on('codeRunning', onRunning);
    socket.on('codeResponse', onResponse);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('interview-state', onState);
      socket.off('interview-ended', onEnded);
      socket.off('submission-result', onResult);
      socket.off('interview-submissions', onSubmissions);
      socket.off('submission-rejected', onRejected);
      socket.off('user-joined', onUsers);
      socket.off('user-Left', onUsers);
      socket.off('languageChange', onLanguage);
      socket.off('codeRunning', onRunning);
      socket.off('codeResponse', onResponse);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [isInterviewer, join]);

  useEffect(() => {
    if (state?.status !== 'ended' && !ended) return undefined;
    if (!isInterviewer || report) return undefined;
    let cancelled = false;
    const load = async () => {
      setReportLoading(true);
      setReportError('');
      try {
        const key = localStorage.getItem(`interview-key:${roomId}`);
        const response = await fetch(`/api/interview/${encodeURIComponent(roomId)}/report`, {
          headers: key ? { 'x-interviewer-key': key } : {},
        });
        if (response.status === 409) {
          if (!cancelled) {
            setReportError('The report is not ready yet. Retrying...');
            setTimeout(load, 1000);
          }
          return;
        }
        if (response.status === 403) throw new Error('Interviewer key missing in this browser');
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Report request failed (${response.status})`);
        }
        if (!cancelled) setReport(await response.json());
      } catch (error) {
        if (!cancelled) setReportError(error.message || 'Could not load the report.');
      } finally {
        if (!cancelled) setReportLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [ended, isInterviewer, report, roomId, state?.status]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const key = interviewerKey;
    const saved = candidate;
    const timer = setTimeout(() => {
      if (key && interviewerName) join({ userName: interviewerName, interviewerKey: key });
      else if (saved) join(saved);
    }, 0);
    return () => {
      clearTimeout(timer);
      socket.emit('leave-room');
      destroySession();
    };
  }, [candidate, destroySession, interviewerKey, interviewerName, join]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !isInterviewer && status !== 'running' });
  }, [isInterviewer, status]);

  const configure = (nextProblem, nextDuration = duration) => {
    setProblemId(nextProblem);
    setDuration(nextDuration);
    socket.emit('interview-configure', { problemId: nextProblem, durationMin: nextDuration });
  };
  const changeLanguage = (event) => {
    const next = event.target.value;
    setLanguage(next);
    const session = sessionRef.current;
    if (session && isDefaultTemplate(session.ytext.toString())) {
      session.doc.transact(() => {
        session.ytext.delete(0, session.ytext.length);
        session.ytext.insert(0, TEMPLATES[next] || '// Start your code here');
      });
    }
    socket.emit('languageChange', { language: next });
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/?interview=${encodeURIComponent(roomId)}`);
    setCopyStatus('Copied');
    setTimeout(() => setCopyStatus(''), 1500);
  };
  const leave = () => {
    socket.emit('leave-room');
    window.location.href = '/';
  };
  const submit = () => {
    if (!state || status !== 'running' || isInterviewer || judging
      || state.submissionsUsed >= state.maxSubmissions) return;
    setRejection('');
    setJudging(true);
    socket.emit('interview-submit');
  };

  if (!interviewerKey && !candidate && !joinStarted) {
    return (
      <div className="join-container">
        <div className="join-form">
          <h2>Join Interview</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          {joinError && <div className="iv-error">{joinError}</div>}
          <button onClick={() => join({ userName: name.trim() })}>Join interview</button>
          <button className="iv-secondary" onClick={leave}>Back to home</button>
        </div>
      </div>
    );
  }
  if (joinError && !state) {
    return <div className="iv-centered"><div className="iv-card"><div className="iv-error">{joinError}</div><button onClick={leave}>Back to home</button></div></div>;
  }
  if (status === 'ended' || ended) {
    const finalSubmission = report?.submissions?.at(-1);
    const final = report?.final || finalSubmission || results.at(-1);
    const endReason = ended?.endReason || state?.endReason || report?.endReason || 'ended';
    return (
      <div className="iv-ended">
        <header className="iv-topbar"><strong>Interview ended</strong><span>{endReason}</span></header>
        <main className="iv-ended-content">
          <section className="iv-ended-summary">
            <h2>{report?.problem?.title || state?.problem?.title || 'Interview'}</h2>
            <p>{state?.interviewerName || report?.interviewerName || 'Interviewer'} · {state?.candidateName || report?.candidateName || 'Candidate'}</p>
            <p>Reason: {endReason} · Used {formatTime(report?.usedMs || 0)} / {formatTime(report?.durationMs || state?.durationMs || 0)}</p>
            {final ? (
              <>
                <p className="iv-final-verdict"><Verdict value={final.verdict} /> {VERDICT_LABELS[final.verdict] || final.verdict} · {final.passed}/{final.total} passed</p>
                <div className="iv-test-verdicts">
                  {final.tests?.map((test) => <span key={test.i}>Test {test.i + 1}: <Verdict value={test.verdict} /></span>)}
                </div>
              </>
            ) : <p className="iv-muted">No final submission.</p>}
            <button type="button" onClick={leave}>Back to home</button>
          </section>
          {isInterviewer && (
            <section className="iv-report-panel">
              {reportLoading && <p>Loading report...</p>}
              {reportError && <p className="iv-error">{reportError}</p>}
              {report && (
                <>
                  <div className="iv-report-actions">
                    <a href={report.replayPath}>Watch replay</a>
                    <button type="button" onClick={() => downloadReport(report, roomId)}>Download report (JSON)</button>
                    <button type="button" onClick={() => window.print()}>Print / Save as PDF</button>
                  </div>
                  <h3>Submissions</h3>
                  <SubmissionList
                    submissions={report.submissions || []}
                    selected={selectedSubmission}
                    onSelect={setSelectedSubmission}
                  />
                  <SubmissionDetails submission={selectedSubmission} />
                  {report.final && <><h3>Final code</h3><pre className="iv-code-preview">{report.final.code}</pre></>}
                </>
              )}
            </section>
          )}
        </main>
      </div>
    );
  }

  const problem = state?.problem;
  const lobby = status === 'lobby';
  return (
    <div className="iv-shell">
      {reconnecting && <div className="iv-reconnecting">Reconnecting...</div>}
      <header className="iv-topbar">
        <strong>{isInterviewer ? 'Interviewer' : 'Candidate'}</strong>
        <span>{state?.interviewerName || interviewerName || 'Interviewer'} · {state?.candidateName || 'Candidate'}</span>
        {remaining !== null && <span className={remaining < 300000 ? 'iv-countdown urgent' : 'iv-countdown'}>{formatTime(remaining)}</span>}
        <select value={language} onChange={changeLanguage} disabled={!isInterviewer && status !== 'running'}>
          {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {isInterviewer && status === 'running' && <button onClick={() => window.confirm('End this interview?') && socket.emit('interview-end')}>End interview</button>}
      </header>
      {lobby ? (
        <div className="iv-lobby">
          <section>
            <h2>{isInterviewer ? 'Configure interview' : 'Waiting for the interviewer to start...'}</h2>
            {isInterviewer && (
              <>
                <label>Problem<select value={problemId} onChange={(e) => configure(e.target.value)}><option value="">Choose a problem</option>{(state?.problemBank || []).map((p) => <option key={p.id} value={p.id}>{p.title} ({p.difficulty})</option>)}</select></label>
                <label>Duration<select value={duration} onChange={(e) => configure(problemId, Number(e.target.value))}>{DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}</select></label>
                <button disabled={!problem} onClick={() => socket.emit('interview-start')}>Start interview</button>
                <button onClick={copyLink}>Copy candidate link</button>
                <p className="iv-muted">The interviewer key stays in this browser. {copyStatus}</p>
              </>
            )}
            {!isInterviewer && <p>{state?.candidateName || userName} · interviewer: {state?.interviewerName || '—'}</p>}
            <p>Interviewer present: {state?.interviewerPresent ? 'yes' : 'no'} · Candidate present: {state?.candidatePresent ? 'yes' : 'no'}</p>
          </section>
          {problem && <ProblemPanel problem={problem} />}
        </div>
      ) : (
        <div className="iv-running">
          <ProblemPanel problem={problem} />
          <section className="iv-editor-area">
            <Editor height="100%" language={language} defaultLanguage={language} theme="vs-light" options={{ minimap: { enabled: false }, fontSize: 16, readOnly: !isInterviewer && status !== 'running' }} onMount={(editor) => {
              editorRef.current = editor;
              const session = sessionRef.current;
              if (!session || bindingRef.current) return;
              bindingRef.current = new MonacoBinding(session.ytext, editor.getModel(), new Set([editor]), session.awareness);
              refreshCursors();
            }} />
            <textarea className="input-console" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Enter input for the program..." />
            <button className="run-btn" disabled={running || (!isInterviewer && status !== 'running')} onClick={() => socket.emit('compileCode', { language, input })}>{running ? 'Running...' : 'Run sample'}</button>
            <textarea className="output-area" value={output} readOnly placeholder="Output will appear here..." />
            {isInterviewer && <section className="iv-submissions-panel">
              <h3>Submissions {judging && <span className="iv-muted">Candidate is judging...</span>}</h3>
              <SubmissionList submissions={submissions} selected={selectedSubmission} onSelect={setSelectedSubmission} />
              <SubmissionDetails submission={selectedSubmission} />
            </section>}
            {!isInterviewer && <section className="iv-candidate-actions">
              <div>Attempts: {state?.submissionsUsed || 0}/{state?.maxSubmissions || 0}</div>
              {judging && <span className="iv-muted">Judging...</span>}
              {rejection && <span className="iv-rejection">{rejection}</span>}
              <button type="button" className="iv-submit" disabled={judging || status !== 'running' || (state?.submissionsUsed || 0) >= (state?.maxSubmissions || 0)} onClick={submit}>
                {judging ? 'Judging...' : 'Submit solution'}
              </button>
              <CandidateResults results={results} />
            </section>}
          </section>
          <aside className="iv-participants"><h3>Participants</h3>{users.map((user, i) => <div key={`${user}-${i}`}>{user}</div>)}</aside>
        </div>
      )}
    </div>
  );
}

function ProblemPanel({ problem }) {
  if (!problem) return <section className="iv-problem-panel"><p>Waiting for the interviewer to choose a problem.</p></section>;
  return <section className="iv-problem-panel"><h2>{problem.title}</h2><span className="iv-badge">{problem.difficulty}</span><pre>{problem.statement}</pre><h3>Samples</h3>{problem.samples?.map((sample, i) => <div className="iv-sample" key={i}><pre>{sample.input}</pre><pre>{sample.output}</pre></div>)}</section>;
}
