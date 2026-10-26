import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { Doc as YDoc } from 'yjs';
import { PROBLEMS, publicProblem, listProblems } from './problems.js';
import {
    WANDBOX_COMPILERS,
    MAX_CODE,
    MAX_UPDATE_BYTES,
    MAX_EVENTS,
    MAX_RECORDING_BYTES,
    MAX_FINISHED,
    FINISHED_TTL_MS,
    MAX_SUBMISSIONS,
    SUBMIT_COOLDOWN_MS,
    GRACE_MS,
    JUDGE_TIMEOUT_MS,
    MAX_FINISHED_INTERVIEWS,
    FINISHED_INTERVIEW_TTL_MS,
    ALLOWED_DURATIONS_MIN,
    MAX_INTERVIEW_DURATION_MS,
    ALLOW_SHORT,
    JUDGE_MAX_ATTEMPTS,
} from './config/constants.js';
import { runOnWandbox, compileWithWandbox } from './services/wandbox.js';
import { registerApiRoutes } from './routes/api.js';
import {
    toUpdateBytes,
    generateKey,
    timingSafeEqualStr,
    normalizeForCompare,
} from './utils/validation.js';
import { Awareness } from 'y-protocols/awareness';
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';

// Generate an 8-char lowercase alphanumeric room id (no collision with existing rooms).
function generateRoomId() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    do {
        const bytes = crypto.randomBytes(8);
        id = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    } while (rooms.has(id));
    return id;
}

const app = express();
// Render sits behind a proxy: trust X-Forwarded-For so per-IP rate limiting
// (replay + interview report) buckets users individually, not all as one IP.
app.set('trust proxy', 1);

const port = process.env.PORT || 5000;
const server = http.createServer(app);



const io = new Server(server, {
    cors: {
        origin: process.env.ALLOWED_ORIGIN || '*',
    },
});

const rooms = new Map();
// Finished recordings kept after a room is deleted, keyed by roomId.
const finishedRecordings = new Map();
// Finished interview reports kept after a room is deleted, keyed by roomId.
const finishedInterviews = new Map();

function createRecording(roomId) {
    return {
        roomId,
        startedAt: Date.now(),
        endedAt: null,
        truncated: false,
        bytes: 0,
        events: [],
    };
}

function recordEvent(rec, ev) {
    if (!rec || rec.truncated) return;
    if (rec.events.length >= MAX_EVENTS) {
        rec.truncated = true;
        return;
    }
    let size = 0;
    if (ev.k === 'doc') size = ev.d.length;
    else if (ev.k === 'run') size = (ev.out || '').length;
    else if (ev.k === 'lang') size = (ev.v || '').length;
    else if (ev.k === 'join' || ev.k === 'leave') size = (ev.u || '').length;
    else if (ev.k === 'mark') size = (ev.label || '').length;
    if (rec.bytes + size > MAX_RECORDING_BYTES) {
        rec.truncated = true;
        return;
    }
    rec.bytes += size;
    rec.events.push(ev);
}

function pruneFinishedRecordings() {
    const now = Date.now();
    for (const [key, rec] of finishedRecordings) {
        const ts = rec.endedAt || rec.startedAt;
        if (now - ts > FINISHED_TTL_MS) finishedRecordings.delete(key);
    }
    while (finishedRecordings.size > MAX_FINISHED) {
        let oldestKey = null;
        let oldestTs = Infinity;
        for (const [key, rec] of finishedRecordings) {
            const ts = rec.endedAt || rec.startedAt;
            if (ts < oldestTs) {
                oldestTs = ts;
                oldestKey = key;
            }
        }
        if (oldestKey === null) break;
        finishedRecordings.delete(oldestKey);
    }
}

function finalizeRecording(roomId, room) {
    const rec = room.recording;
    if (!rec) return;
    rec.endedAt = Date.now();
    room.recording = null;
    // A newer session for the same roomId REPLACES the older one (Map.set overwrites).
    finishedRecordings.set(roomId, rec);
    pruneFinishedRecordings();
}

// Record a "mark" timeline event for interview milestones.
function recordMark(room, label) {
    if (room.recording) {
        recordEvent(room.recording, {
            t: Date.now() - room.recording.startedAt,
            k: 'mark',
            label,
        });
    }
}

// Build the interview state payload for a single socket with a known role.
function buildInterviewState(room, role) {
    const iv = room.interview;
    const p = iv.problemId ? PROBLEMS.find((x) => x.id === iv.problemId) : null;
    const state = {
        role,
        status: iv.status,
        problem: p ? publicProblem(p) : null,
        durationMs: iv.durationMs,
        startedAt: iv.startedAt,
        endsAt: iv.endsAt,
        serverNow: Date.now(),
        submissionsUsed: iv.submissions.length + (iv.judging ? 1 : 0),
        maxSubmissions: MAX_SUBMISSIONS,
        interviewerName: iv.interviewerName,
        candidateName: iv.candidateName,
        interviewerPresent: !!iv.interviewerSocketId && room.users.has(iv.interviewerSocketId),
        candidatePresent: !!iv.candidateSocketId && room.users.has(iv.candidateSocketId),
    };
    // problemBank is visible to the interviewer (always) and to anyone while in lobby.
    if (role === 'interviewer' || iv.status === 'lobby') {
        state.problemBank = listProblems();
    }
    return state;
}

function emitInterviewState(roomId, socket) {
    if (!rooms.has(roomId) || !socket) return;
    const room = rooms.get(roomId);
    const iv = room.interview;
    if (!iv) return;
    let role;
    if (iv.interviewerSocketId === socket.id) role = 'interviewer';
    else if (iv.candidateSocketId === socket.id) role = 'candidate';
    else role = 'viewer';
    socket.emit('interview-state', buildInterviewState(room, role));
}

function broadcastInterviewState(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.interview) return;
    for (const socketId of room.users.keys()) {
        const sock = io.sockets.sockets.get(socketId);
        if (sock) emitInterviewState(roomId, sock);
    }
}

// Wandbox reports failures differently per language family:
//   * compiled languages (cpp/java) -> compiler_error is populated, status != 0.
//   * python -> compiler_error is EMPTY; a parse error lands in program_message
//     WITHOUT a "Traceback (most recent call last):" header, while a runtime
//     exception always has that header.
//   * nodejs -> compiler_error is EMPTY; a parse error says "SyntaxError:" but
//     has NO stack frame pointing into the user's file (the code never ran),
//     while a runtime exception always has such a frame.
const PY_COMPILE_ERROR_RE = /\b(SyntaxError|IndentationError|TabError)\b/;
const NODE_USER_FRAME_RE = /\/prog\.js:\d+:\d+/;

function isCompileError(language, message) {
    if (!message) return false;
    if (language === 'python') {
        if (message.includes('Traceback (most recent call last):')) return false;
        return PY_COMPILE_ERROR_RE.test(message);
    }
    if (language === 'javascript') {
        if (!message.includes('SyntaxError:')) return false;
        return !NODE_USER_FRAME_RE.test(message);
    }
    return false;
}

// Run one hidden test: returns { verdict, ms, actual }.
// A transient Wandbox infrastructure failure (IE) is retried, because the
// public instance is shared and often cannot start a container.
async function judgeTest(language, code, testInput, testExpected) {
    let last = { verdict: 'IE', ms: 0, actual: '' };
    for (let attempt = 1; attempt <= JUDGE_MAX_ATTEMPTS; attempt++) {
        const res = await compileWithWandbox(language, code, testInput, JUDGE_TIMEOUT_MS);
        if (res.compilerError) {
            return { verdict: 'CE', ms: res.ms, actual: String(res.compilerError).slice(0, 5000) };
        }
        if (res.timeOut) return { verdict: 'TLE', ms: res.ms, actual: '' };
        if (res.internalError) {
            last = { verdict: 'IE', ms: res.ms, actual: String(res.internalError).slice(0, 5000) };
            if (attempt < JUDGE_MAX_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, 1500 * attempt));
                continue;
            }
            return last;
        }
        // Wandbox may report the exit status as a number or a numeric string.
        const status = typeof res.status === 'string' ? Number(res.status) : res.status;
        if (typeof status === 'number' && Number.isFinite(status) && status !== 0) {
            const msg = res.programMessage || res.programOutput || '';
            if (isCompileError(language, msg)) {
                return { verdict: 'CE', ms: res.ms, actual: String(msg).slice(0, 5000) };
            }
            return { verdict: 'RE', ms: res.ms, actual: String(msg).slice(0, 5000) };
        }
        const actual = res.programOutput || '';
        if (normalizeForCompare(actual) === normalizeForCompare(testExpected)) {
            return { verdict: 'AC', ms: res.ms, actual: actual.slice(0, 5000) };
        }
        return { verdict: 'WA', ms: res.ms, actual: actual.slice(0, 5000) };
    }
    return last;
}

// Judge the server's current Yjs doc text against all hidden tests of the problem.
async function judgeSubmission(room, roomId, reason, force = false) {
    const iv = room.interview;
    if (!iv) return null;
    if (!force && iv.status !== 'running') return null;
    const problem = PROBLEMS.find((p) => p.id === iv.problemId);
    if (!problem) return null;

    const code = room.ydoc.getText('monaco').toString();
    if (typeof code !== 'string' || code.length > MAX_CODE) return null;

    iv.judging = true;
    const index = iv.submissions.length;
    const results = [];
    let overallVerdict = 'AC';
    let stopped = false;

    try {
        for (let i = 0; i < problem.tests.length; i++) {
            if (stopped) {
                results.push({ i, verdict: 'skipped', ms: 0, input: '', expected: '', actual: '' });
                continue;
            }
            const test = problem.tests[i];
            const result = await judgeTest(room.language, code, test.input, test.output);
            results.push({
                i,
                verdict: result.verdict,
                ms: result.ms,
                input: test.input,
                expected: test.output,
                actual: result.actual,
            });
            if (result.verdict !== 'AC' && overallVerdict === 'AC') {
                overallVerdict = result.verdict;
                // Only a CE on the FIRST test stops the run early (the program
                // cannot compile, so every later test would fail the same way).
                if (overallVerdict === 'CE' && i === 0) stopped = true;
            }
        }

        const passed = results.filter((r) => r.verdict === 'AC').length;
        const submission = {
            index,
            t: iv.startedAt ? Date.now() - iv.startedAt : 0,
            language: room.language,
            code,
            verdict: overallVerdict,
            passed,
            total: problem.tests.length,
            reason,
            tests: results,
        };
        iv.submissions.push(submission);
        iv.lastSubmitAt = Date.now();

        recordMark(room, `Submission #${index}: ${overallVerdict} (${passed}/${problem.tests.length})`);

        // Candidate receives a sanitized result (no hidden test details).
        const candSocket = iv.candidateSocketId ? io.sockets.sockets.get(iv.candidateSocketId) : null;
        if (candSocket && rooms.has(roomId)) {
            candSocket.emit('submission-result', {
                index,
                verdict: overallVerdict,
                passed,
                total: problem.tests.length,
                tests: results.map((r) => ({ i: r.i, verdict: r.verdict })),
            });
        }

        // Interviewer receives the full detail list.
        const intvSocket = iv.interviewerSocketId ? io.sockets.sockets.get(iv.interviewerSocketId) : null;
        if (intvSocket && rooms.has(roomId)) {
            intvSocket.emit('interview-submissions', iv.submissions.map((s) => ({
                index: s.index,
                t: s.t,
                language: s.language,
                code: s.code,
                verdict: s.verdict,
                passed: s.passed,
                total: s.total,
                reason: s.reason,
                tests: s.tests.map((t) => ({
                    i: t.i,
                    verdict: t.verdict,
                    ms: t.ms,
                    input: t.input,
                    expected: t.expected,
                    actual: t.actual ? t.actual.slice(0, 500) : '',
                })),
            })));
        }

        broadcastInterviewState(roomId);
        return submission;
    } finally {
        iv.judging = false;
    }
}

// Build the final report for an interview room.
function buildInterviewReport(roomId, room) {
    const iv = room.interview;
    if (!iv) return null;
    const problem = PROBLEMS.find((p) => p.id === iv.problemId);
    const last = iv.submissions.length ? iv.submissions[iv.submissions.length - 1] : null;
    const report = {
        roomId,
        problem: problem ? { id: problem.id, title: problem.title, difficulty: problem.difficulty } : null,
        interviewerName: iv.interviewerName,
        candidateName: iv.candidateName,
        startedAt: iv.startedAt,
        endedAt: iv.endedAt,
        endReason: iv.endReason,
        durationMs: iv.durationMs,
        usedMs: iv.startedAt && iv.endedAt ? Math.max(0, iv.endedAt - iv.startedAt) : 0,
        submissions: iv.submissions.map((s) => ({
            index: s.index,
            t: s.t,
            language: s.language,
            code: s.code,
            verdict: s.verdict,
            passed: s.passed,
            total: s.total,
            reason: s.reason,
            tests: s.tests.map((t) => ({
                i: t.i,
                verdict: t.verdict,
                ms: t.ms,
                input: t.input,
                expected: t.expected,
                actual: t.actual ? t.actual.slice(0, 500) : '',
            })),
        })),
        final: last ? {
            code: last.code,
            language: last.language,
            verdict: last.verdict,
            passed: last.passed,
            total: last.total,
        } : null,
        replayPath: '/?replay=' + roomId,
        // Internal: needed to authorize report fetches after the room is gone.
        // Stripped before the JSON is sent.
        _interviewerKey: iv.interviewerKey,
    };
    return report;
}

// Move an ended interview's report into the module-level finished map.
function finalizeInterview(roomId, room) {
    const report = room.interviewReport || buildInterviewReport(roomId, room);
    if (report) {
        room.interviewReport = report;
        finishedInterviews.set(roomId, report);
        pruneFinishedInterviews();
    }
}

function pruneFinishedInterviews() {
    const now = Date.now();
    for (const [key, rep] of finishedInterviews) {
        const ts = rep.endedAt || rep.startedAt || now;
        if (now - ts > FINISHED_INTERVIEW_TTL_MS) finishedInterviews.delete(key);
    }
    while (finishedInterviews.size > MAX_FINISHED_INTERVIEWS) {
        let oldestKey = null;
        let oldestTs = Infinity;
        for (const [key, rep] of finishedInterviews) {
            const ts = rep.endedAt || rep.startedAt || now;
            if (ts < oldestTs) {
                oldestTs = ts;
                oldestKey = key;
            }
        }
        if (oldestKey === null) break;
        finishedInterviews.delete(oldestKey);
    }
}

// End an interview: flip state, emit, optionally run the final auto judge.
// Returns a promise that settles when the (optional) final judge is done.
async function endInterview(roomId, room, endReason, runFinalJudge = true) {
    const iv = room.interview;
    if (!iv || iv.status === 'ended') return;
    iv.status = 'ended';
    iv.endedAt = Date.now();
    iv.endReason = endReason;
    if (iv.timer) {
        clearTimeout(iv.timer);
        iv.timer = null;
    }
    if (iv.graceTimer) {
        clearTimeout(iv.graceTimer);
        iv.graceTimer = null;
    }
    recordMark(room, `Interview ended (${endReason})`);
    io.to(roomId).emit('interview-ended', { endReason, endedAt: iv.endedAt });
    // Publish the "ended" state immediately (do not wait for the final judge).
    if (rooms.has(roomId)) broadcastInterviewState(roomId);

    // Final auto judge ONLY if the doc changed since the last submission.
    const last = iv.submissions.length ? iv.submissions[iv.submissions.length - 1] : null;
    let currentCode = '';
    try {
        currentCode = room.ydoc.getText('monaco').toString();
    } catch {
        currentCode = '';
    }
    if (runFinalJudge && (!last || last.code !== currentCode)) {
        try {
            await judgeSubmission(room, roomId, 'auto', true);
        } catch (err) {
            console.error('final judge failed:', err?.message);
        }
    }
    // Build (or refresh) the report now that the submissions are final.
    try {
        room.interviewReport = buildInterviewReport(roomId, room);
    } catch (err) {
        console.error('build report failed:', err?.message);
    }
    if (rooms.has(roomId)) broadcastInterviewState(roomId);
}

function leave(socket) {
    const roomId = socket.currentRoom;
    if (!roomId || !rooms.has(roomId)) {
        socket.currentRoom = null;
        socket.currentUser = null;
        return;
    }
    const room = rooms.get(roomId);
    socket.leave(roomId);

    if (socket.data && socket.data.awarenessIds && socket.data.awarenessIds.size) {
        const ids = [...socket.data.awarenessIds];
        socket.data.awarenessIds.clear();
        removeAwarenessStates(room.awareness, ids, null);
    }

    const userName = socket.currentUser;
    room.users.delete(socket.id);
    if (room.recording && userName) {
        recordEvent(room.recording, {
            t: Date.now() - room.recording.startedAt,
            k: 'leave',
            u: userName,
        });
    }
    if (room.users.size === 0) {
        // Interview rooms in lobby/running get a grace period instead of an
        // immediate delete, so a refresh/reconnect does not kill the session.
        if (room.interview && (room.interview.status === 'lobby' || room.interview.status === 'running')) {
            const iv = room.interview;
            if (!iv.graceTimer) {
                const graceToken = {};
                iv.graceToken = graceToken;
                iv.graceTimer = setTimeout(() => {
                    const live = rooms.get(roomId);
                    if (!live || !live.interview) return;
                    // A newer grace timer superseded this one -> ignore.
                    if (live.interview.graceToken !== graceToken) return;
                    live.interview.graceToken = null;
                    live.interview.graceTimer = null;
                    if (live.users.size > 0) return;
                    // Grace expired -> abandon the interview and clean up.
                    endInterview(roomId, live, 'abandoned', false)
                        .catch((err) => console.error('abandon failed:', err?.message))
                        .finally(() => {
                            if (!rooms.has(roomId)) return;
                            const cur = rooms.get(roomId);
                            // Somebody rejoined during the shutdown -> keep the room.
                            if (cur.users.size > 0) return;
                            if (cur.interview && cur.interview.timer) {
                                clearTimeout(cur.interview.timer);
                                cur.interview.timer = null;
                            }
                            finalizeInterview(roomId, cur);
                            finalizeRecording(roomId, cur);
                            cur.awareness.destroy();
                            if (cur.ydocUpdateHandler) {
                                cur.ydoc.off('update', cur.ydocUpdateHandler);
                                cur.ydocUpdateHandler = null;
                            }
                            cur.ydoc.destroy();
                            rooms.delete(roomId);
                        });
                }, GRACE_MS);
                if (iv.graceTimer.unref) iv.graceTimer.unref();
            }
            socket.currentRoom = null;
            socket.currentUser = null;
            socket.interviewRole = null;
            return;
        }
        room.awareness.destroy();
        // Detach the ydoc update listener so it cannot leak after destroy().
        if (room.ydocUpdateHandler) {
            room.ydoc.off('update', room.ydocUpdateHandler);
            room.ydocUpdateHandler = null;
        }
        if (room.interview) {
            // Ended interview: keep the report + recording, clear all timers.
            if (room.interview.timer) {
                clearTimeout(room.interview.timer);
                room.interview.timer = null;
            }
            if (room.interview.graceTimer) {
                clearTimeout(room.interview.graceTimer);
                room.interview.graceTimer = null;
                room.interview.graceToken = null;
            }
            finalizeInterview(roomId, room);
        }
        finalizeRecording(roomId, room);
        room.ydoc.destroy();
        rooms.delete(roomId);
    } else {
        io.to(roomId).emit("user-Left", [...room.users.values()]);
        io.to(roomId).emit("room-participants", [...room.users].map(([id, name]) => ({ id, name })));
    }
    socket.currentRoom = null;
    socket.currentUser = null;
    socket.interviewRole = null;
}

// Remove a stale role-holder socket from the room when a new socket takes over
// the role (refresh / reconnect). The stale socket is disconnected so it can
// no longer act with the old role.
function evictStaleSocket(room, roomId, staleId, newId) {
    if (!staleId || staleId === newId) return;
    if (!room.users.has(staleId)) return;
    room.users.delete(staleId);
    const stale = io.sockets.sockets.get(staleId);
    if (stale) {
        try {
            // Tell the replaced session why it lost the room: socket.io does
            // not auto-reconnect after a server-initiated disconnect, so
            // without this the old tab would just sit there frozen.
            stale.emit('interview-evicted', { reason: 'This interview was opened in another tab.' });
            stale.leave(roomId);
            stale.currentRoom = null;
            stale.currentUser = null;
            stale.interviewRole = null;
            stale.disconnect(true);
        } catch {
            /* socket already gone */
        }
    }
    io.to(roomId).emit("user-Left", [...room.users.values()]);
    io.to(roomId).emit("room-participants", [...room.users].map(([id, name]) => ({ id, name })));
}

// Create a fresh room (Yjs doc, awareness, recording) with the default seed text.
function createRoom(cleanRoomId, initialLanguage = 'python') {
    const ydoc = new YDoc();
    ydoc.clientID = 1;
    const seedText = initialLanguage === 'python'
        ? '# Hello World\nprint("Hello, World!")'
        : '// Start your code here';
    ydoc.getText("monaco").insert(0, seedText);
    const awareness = new Awareness(ydoc);
    awareness.setLocalState(null);

    const recording = createRecording(cleanRoomId);
    // FIRST event: full seed state at t=0 so replay starts from the seed text.
    recordEvent(recording, {
        t: 0,
        k: 'doc',
        d: Buffer.from(encodeStateAsUpdate(ydoc)).toString('base64'),
    });
    recordEvent(recording, { t: 0, k: 'lang', v: initialLanguage });

    const ydocUpdateHandler = (update, origin) => {
        // Guard: the room may already have been finalized/destroyed.
        if (!rooms.has(cleanRoomId)) return;
        // Special origins let a caller apply a change without relaying it to
        // the room and/or without recording it (used to revert a candidate
        // edit made before the interview started).
        const silent = !!(origin && origin.__silent);
        const noRecord = !!(origin && origin.__noRecord);
        if (!noRecord) {
            recordEvent(recording, {
                t: Date.now() - recording.startedAt,
                k: 'doc',
                d: Buffer.from(update).toString('base64'),
            });
        }
        if (silent) return;
        if (origin && typeof origin.to === 'function') {
            origin.to(cleanRoomId).emit("yjs-update", update);
        } else {
            io.to(cleanRoomId).emit("yjs-update", update);
        }
    };
    ydoc.on("update", ydocUpdateHandler);

    awareness.on("update", ({ added, updated, removed }, origin) => {
        // Track announced clientIDs on the ORIGIN socket so leave() can
        // remove exactly this socket's states when it disconnects.
        if (origin && origin.data) {
            const tracked = new Set(origin.data.awarenessIds || []);
            for (const id of [...added, ...updated]) tracked.add(id);
            for (const id of removed) tracked.delete(id);
            origin.data.awarenessIds = tracked;
        }
        const encoded = encodeAwarenessUpdate(
            awareness,
            [...added, ...updated, ...removed]
        );
        if (origin && typeof origin.to === 'function') {
            origin.to(cleanRoomId).emit("awareness-update", encoded);
        } else {
            // origin === null (leave()-triggered removal): tell everyone.
            io.to(cleanRoomId).emit("awareness-update", encoded);
        }
    });

    const room = {
        users: new Map(),
        ydoc,
        awareness,
        language: initialLanguage,
        running: false,
        recording,
        ydocUpdateHandler,
        interview: null,
        interviewReport: null,
    };
    rooms.set(cleanRoomId, room);
    return room;
}

// Shared join logic for BOTH normal rooms and interview rooms.
// role: null for normal rooms, 'interviewer' | 'candidate' for interview rooms.
function joinRoom(socket, roomId, userName, role) {
    if (typeof roomId !== 'string' || roomId.trim() === '') return false;
    if (typeof userName !== 'string' || userName.trim() === '') return false;

    const cleanRoomId = roomId.slice(0, 100);
    const cleanUserName = userName.trim().slice(0, 30);

    leave(socket);

    socket.currentRoom = cleanRoomId;
    socket.currentUser = cleanUserName;
    socket.interviewRole = role || null;

    socket.join(cleanRoomId);

    if (!rooms.has(cleanRoomId)) createRoom(cleanRoomId);

    const room = rooms.get(cleanRoomId);
    room.users.set(socket.id, cleanUserName);
    // Rejoining an interview room cancels a pending grace-delete timer.
    if (room.interview && room.interview.graceTimer) {
        clearTimeout(room.interview.graceTimer);
        room.interview.graceTimer = null;
    }
    if (room.recording) {
        recordEvent(room.recording, {
            t: Date.now() - room.recording.startedAt,
            k: 'join',
            u: cleanUserName,
        });
    }

    socket.emit("yjs-init", {
        doc: encodeStateAsUpdate(room.ydoc),
        awareness: encodeAwarenessUpdate(
            room.awareness,
            [...room.awareness.getStates().keys()]
        ),
    });
    socket.emit("languageChange", room.language);

    io.to(cleanRoomId).emit("user-joined", [...room.users.values()]);
    io.to(cleanRoomId).emit("room-participants", [...room.users].map(([id, name]) => ({ id, name })));
    return true;
}

io.on('connection', (socket) => {
    console.log("A user connected", socket.id);
    socket.currentRoom = null;
    socket.currentUser = null;
    socket.lastCompileTime = 0;
    socket.data = socket.data || {};
    socket.data.awarenessIds = new Set();

    socket.on("join", (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const { roomId, userName } = payload;
        joinRoom(socket, roomId, userName, null);
    });

    // ---- Interview mode ----

    // create-interview ({ userName }, ack) -> { ok, roomId, interviewerKey }
    socket.on("create-interview", (payload, ack) => {
        const respond = (obj) => {
            if (typeof ack === 'function') { try { ack(obj); } catch { /* ignore */ } }
        };
        try {
            if (!payload || typeof payload !== 'object') {
                return respond({ ok: false, error: 'Invalid payload' });
            }
            const { userName } = payload;
            if (typeof userName !== 'string' || userName.trim() === '') {
                return respond({ ok: false, error: 'Invalid user name' });
            }
            const cleanUserName = userName.trim().slice(0, 30);
            const roomId = generateRoomId();
            const interviewerKey = generateKey();

            // Create the room shell without joining it yet.
            const room = createRoom(roomId, 'javascript');
            room.interview = {
                status: 'lobby',
                interviewerKey,
                candidateKey: null,
                interviewerSocketId: null,
                candidateSocketId: null,
                interviewerName: cleanUserName,
                candidateName: null,
                problemId: null,
                durationMs: 45 * 60 * 1000,
                startedAt: null,
                endsAt: null,
                endedAt: null,
                endReason: null,
                submissions: [],
                judging: false,
                lastSubmitAt: 0,
                timer: null,
                graceTimer: null,
                graceToken: null,
            };

            // The interviewer joins as a normal participant (shared join path).
            joinRoom(socket, roomId, cleanUserName, 'interviewer');
            const live = rooms.get(roomId);
            if (live && live.interview) {
                live.interview.interviewerSocketId = socket.id;
            }
            // Answer the ack FIRST, then deliver the state in a later tick, so a
            // client that awaits the ack and only then subscribes to
            // "interview-state" still receives it.
            respond({ ok: true, roomId, interviewerKey });
            setImmediate(() => broadcastInterviewState(roomId));
        } catch (err) {
            console.error('create-interview failed:', err?.message);
            respond({ ok: false, error: 'Failed to create interview' });
        }
    });

    // join-interview ({ roomId, userName, interviewerKey?, candidateKey? }, ack)
    socket.on("join-interview", (payload, ack) => {
        const respond = (obj) => {
            if (typeof ack === 'function') { try { ack(obj); } catch { /* ignore */ } }
        };
        try {
            if (!payload || typeof payload !== 'object') {
                return respond({ ok: false, error: 'Invalid payload' });
            }
            const { roomId, userName, interviewerKey, candidateKey } = payload;
            if (typeof roomId !== 'string' || roomId.trim() === '') {
                return respond({ ok: false, error: 'Invalid room id' });
            }
            if (typeof userName !== 'string' || userName.trim() === '') {
                return respond({ ok: false, error: 'Invalid user name' });
            }
            const cleanRoomId = roomId.slice(0, 100);
            const cleanUserName = userName.trim().slice(0, 30);

            // Must exist AND be an interview room. Never create one here.
            if (!rooms.has(cleanRoomId)) {
                return respond({ ok: false, error: 'Interview room not found' });
            }
            const room = rooms.get(cleanRoomId);
            if (!room.interview) {
                return respond({ ok: false, error: 'Interview room not found' });
            }
            const iv = room.interview;

            // A valid interviewer key grants the interviewer role.
            const isInterviewer = typeof interviewerKey === 'string'
                && interviewerKey.length > 0
                && timingSafeEqualStr(interviewerKey, iv.interviewerKey);

            if (isInterviewer) {
                // Replaces a stale interviewer socket (refresh / reconnect).
                const staleId = iv.interviewerSocketId;
                joinRoom(socket, cleanRoomId, cleanUserName, 'interviewer');
                evictStaleSocket(room, cleanRoomId, staleId, socket.id);
                iv.interviewerSocketId = socket.id;
                iv.interviewerName = cleanUserName;
                if (iv.graceTimer) { clearTimeout(iv.graceTimer); iv.graceTimer = null; iv.graceToken = null; }
                respond({ ok: true, role: 'interviewer' });
                setImmediate(() => broadcastInterviewState(cleanRoomId));
                return;
            }

            // Otherwise: candidate. Allowed only if the candidate slot is free
            // (no candidate currently in the room) OR the candidateKey matches
            // (reclaim after refresh/reconnect, replacing the stale socket).
            const candidatePresent = !!iv.candidateSocketId
                && room.users.has(iv.candidateSocketId);
            const keyMatches = typeof candidateKey === 'string'
                && candidateKey.length > 0
                && !!iv.candidateKey
                && timingSafeEqualStr(candidateKey, iv.candidateKey);

            if (candidatePresent && !keyMatches) {
                return respond({ ok: false, error: 'Interview already has a candidate' });
            }

            // First candidate, or a fresh candidate taking over a free slot:
            // mint a NEW key (invalidating any previous one). When the holder
            // returns with their own key the existing key is kept.
            if (!iv.candidateKey || !keyMatches) iv.candidateKey = generateKey();

            // Reclaim after refresh/reconnect: replace the stale candidate socket.
            const staleCandId = iv.candidateSocketId;
            joinRoom(socket, cleanRoomId, cleanUserName, 'candidate');
            evictStaleSocket(room, cleanRoomId, staleCandId, socket.id);
            iv.candidateSocketId = socket.id;
            iv.candidateName = cleanUserName;
            if (iv.graceTimer) { clearTimeout(iv.graceTimer); iv.graceTimer = null; iv.graceToken = null; }
            respond({ ok: true, role: 'candidate', candidateKey: iv.candidateKey });
            setImmediate(() => broadcastInterviewState(cleanRoomId));
            return;
        } catch (err) {
            console.error('join-interview failed:', err?.message);
            respond({ ok: false, error: 'Failed to join interview' });
        }
    });

    // Resolve the acting role of a socket from SERVER-side state only.
    const roleOf = (room) => {
        if (!room || !room.interview) return null;
        if (room.interview.interviewerSocketId === socket.id) return 'interviewer';
        if (room.interview.candidateSocketId === socket.id) return 'candidate';
        return null;
    };
    const myRoom = () => {
        const roomId = socket.currentRoom;
        if (!roomId || !rooms.has(roomId)) return null;
        return rooms.get(roomId);
    };

    // interview-configure ({ problemId, durationMin | durationMs }) - interviewer only, lobby only.
    socket.on("interview-configure", (payload) => {
        try {
            const room = myRoom();
            const iv = room && room.interview;
            if (!iv) return;
            if (roleOf(room) !== 'interviewer') return;
            if (iv.status !== 'lobby') return;
            if (!payload || typeof payload !== 'object') return;

            const problem = PROBLEMS.find((p) => p.id === payload.problemId);
            if (!problem) return;

            // Resolve the duration: durationMin (allowed list) OR durationMs (short allowed in tests).
            let durationMs = null;
            if (typeof payload.durationMin === 'number' && Number.isFinite(payload.durationMin)) {
                if (!ALLOWED_DURATIONS_MIN.includes(payload.durationMin)) return;
                durationMs = payload.durationMin * 60 * 1000;
            } else if (
                typeof payload.durationMs === 'number'
                && Number.isSafeInteger(payload.durationMs)
                && payload.durationMs <= MAX_INTERVIEW_DURATION_MS
            ) {
                if (ALLOW_SHORT) {
                    if (payload.durationMs < 2000) return;
                    durationMs = payload.durationMs;
                } else {
                    // Outside test mode, only the allowed minute values are accepted.
                    const minutes = payload.durationMs / 60000;
                    if (!Number.isInteger(minutes) || !ALLOWED_DURATIONS_MIN.includes(minutes)) return;
                    durationMs = payload.durationMs;
                }
            }
            if (durationMs === null) return;

            iv.problemId = problem.id;
            iv.durationMs = durationMs;
            broadcastInterviewState(socket.currentRoom);
        } catch (err) {
            console.error('interview-configure failed:', err?.message);
        }
    });

    // interview-start - interviewer only, lobby only, problem required.
    socket.on("interview-start", () => {
        try {
            const room = myRoom();
            const iv = room && room.interview;
            if (!iv) return;
            if (roleOf(room) !== 'interviewer') return;
            if (iv.status !== 'lobby') return;
            if (!iv.problemId) return;

            iv.status = 'running';
            iv.startedAt = Date.now();
            iv.endsAt = iv.startedAt + iv.durationMs;
            recordMark(room, 'Interview started');
            if (iv.timer) clearTimeout(iv.timer);
            const timerRoomId = socket.currentRoom;
            iv.timer = setTimeout(() => {
                const live = rooms.get(timerRoomId);
                if (!live || !live.interview) return;
                if (live.interview.status !== 'running') return;
                endInterview(timerRoomId, live, 'time')
                    .catch((err) => console.error('interview timer end failed:', err?.message));
            }, iv.durationMs);
            if (iv.timer.unref) iv.timer.unref();
            broadcastInterviewState(socket.currentRoom);
        } catch (err) {
            console.error('interview-start failed:', err?.message);
        }
    });

    // interview-end - interviewer only, running only -> endReason "manual".
    socket.on("interview-end", () => {
        try {
            const room = myRoom();
            const iv = room && room.interview;
            if (!iv) return;
            if (roleOf(room) !== 'interviewer') return;
            if (iv.status !== 'running') return;
            endInterview(socket.currentRoom, room, 'manual')
                .catch((err) => console.error('interview-end failed:', err?.message));
        } catch (err) {
            console.error('interview-end failed:', err?.message);
        }
    });

    // interview-submit - candidate only, running only.
    socket.on("interview-submit", () => {
        try {
            const room = myRoom();
            const iv = room && room.interview;
            if (!iv) return;
            if (roleOf(room) !== 'candidate') return;
            if (iv.status !== 'running') {
                socket.emit('submission-rejected', { reason: 'Interview is not running' });
                return;
            }
            // The in-flight submission counts towards the limit as well: it is
            // only pushed to "submissions" once the judge has finished with it,
            // so counting alone would allow MAX + 1 submissions.
            const usedSubmissions = iv.submissions.length + (iv.judging ? 1 : 0);
            if (usedSubmissions >= MAX_SUBMISSIONS) {
                socket.emit('submission-rejected', { reason: `Maximum of ${MAX_SUBMISSIONS} submissions reached` });
                return;
            }
            const now = Date.now();
            if (iv.lastSubmitAt && now - iv.lastSubmitAt < SUBMIT_COOLDOWN_MS) {
                const wait = Math.ceil((SUBMIT_COOLDOWN_MS - (now - iv.lastSubmitAt)) / 1000);
                socket.emit('submission-rejected', { reason: `Please wait ${wait}s before submitting again` });
                return;
            }
            if (iv.judging) {
                socket.emit('submission-rejected', { reason: 'A submission is already being judged' });
                return;
            }
            // The cooldown window starts when the submission is ACCEPTED, not when
            // judging finishes, so a double-click is rejected right away.
            iv.lastSubmitAt = now;
            // Judge the SERVER's Yjs doc text (never a client-sent code string).
            judgeSubmission(room, socket.currentRoom, 'manual')
                .catch((err) => console.error('interview-submit judge failed:', err?.message));
        } catch (err) {
            console.error('interview-submit failed:', err?.message);
        }
    });

    // Restore the Y.Text to an exact previous string content.
// Computes the common prefix/suffix and issues one delete+insert inside a
// single transaction, so peers see a single, consistent update.
function restoreText(room, target) {
    const ytext = room.ydoc.getText('monaco');
    const current = ytext.toString();
    if (current === target) return;
    let p = 0;
    while (p < target.length && p < current.length && target[p] === current[p]) p++;
    let s = 0;
    while (
        s < target.length - p &&
        s < current.length - p &&
        target[target.length - 1 - s] === current[current.length - 1 - s]
    ) s++;
    const removeLen = current.length - s - p;
    const insertText = target.slice(p, target.length - s);
    // Origin: null -> the update is relayed to the whole room (the candidate
    // needs it too, it must undo its own rejected edit) and it IS recorded,
    // so the replay shows the same compensated net result.
    room.ydoc.transact(() => {
        if (removeLen > 0) ytext.delete(p, removeLen);
        if (insertText) ytext.insert(p, insertText);
    }, null);
}

socket.on("yjs-update", (data) => {
        const roomId = socket.currentRoom;
        if (!roomId || !rooms.has(roomId)) return;
        const room = rooms.get(roomId);
        // Interview rooms: the candidate may only edit while the interview runs.
        if (room.interview) {
            const iv = room.interview;
            const isCandidate = iv.candidateSocketId === socket.id;
            if (isCandidate && iv.status !== 'running') {
                const buf = toUpdateBytes(data);
                if (!buf || buf.length > MAX_UPDATE_BYTES) return;
                const before = room.ydoc.getText('monaco').toString();
                try {
                    // Apply AND relay. The update must reach every peer: if the
                    // server advanced its clock for this client but the peers
                    // did not, their next update would hit a clock gap and be
                    // dropped silently (the candidate could never edit).
                    applyUpdate(room.ydoc, buf, socket);
                } catch (err) {
                    console.error("yjs-update apply failed:", err.message);
                    return;
                }
                // The change must not be visible: undo it and relay the
                // compensation so every peer converges back to the shared text.
                const after = room.ydoc.getText('monaco').toString();
                if (after !== before) restoreText(room, before);
                return;
            }
        }
        const buf = toUpdateBytes(data);
        if (!buf || buf.length > MAX_UPDATE_BYTES) return;
        try {
            applyUpdate(room.ydoc, buf, socket);
        } catch (err) {
            console.error("yjs-update apply failed:", err.message);
        }
    });

    socket.on("awareness-update", (data) => {
        const roomId = socket.currentRoom;
        if (!roomId || !rooms.has(roomId)) return;
        const room = rooms.get(roomId);
        const buf = toUpdateBytes(data);
        if (!buf || buf.length > MAX_UPDATE_BYTES) return;
        try {
            applyAwarenessUpdate(room.awareness, buf, socket);
        } catch (err) {
            console.error("awareness-update apply failed:", err.message);
        }
    });

    socket.on("video-offer", (payload) => {
        const roomId = socket.currentRoom;
        const targetId = payload && typeof payload === 'object' ? payload.targetId : null;
        if (!roomId || !rooms.has(roomId) || typeof targetId !== 'string') return;
        if (!rooms.get(roomId).users.has(targetId)) return;
        io.to(targetId).emit("video-offer", { fromId: socket.id, offer: payload.offer });
    });

    socket.on("video-answer", (payload) => {
        const roomId = socket.currentRoom;
        const targetId = payload && typeof payload === 'object' ? payload.targetId : null;
        if (!roomId || !rooms.has(roomId) || typeof targetId !== 'string') return;
        if (!rooms.get(roomId).users.has(targetId)) return;
        io.to(targetId).emit("video-answer", { fromId: socket.id, answer: payload.answer });
    });

    socket.on("video-ice-candidate", (payload) => {
        const roomId = socket.currentRoom;
        const targetId = payload && typeof payload === 'object' ? payload.targetId : null;
        if (!roomId || !rooms.has(roomId) || typeof targetId !== 'string') return;
        if (!rooms.get(roomId).users.has(targetId)) return;
        io.to(targetId).emit("video-ice-candidate", {
            fromId: socket.id,
            candidate: payload.candidate,
        });
    });

    socket.on("languageChange", (payload) => {
        // Do NOT destructure in the parameter list: a null payload would throw
        // before the body runs and take the whole server down.
        const language = payload && typeof payload === 'object' ? payload.language : undefined;
        const roomId = socket.currentRoom;
        if (!roomId || !rooms.has(roomId)) return;
        if (!WANDBOX_COMPILERS[language]) return;
        const room = rooms.get(roomId);
        room.language = language;
        if (room.recording) {
            recordEvent(room.recording, {
                t: Date.now() - room.recording.startedAt,
                k: 'lang',
                v: language,
            });
        }
        socket.to(roomId).emit("languageChange", language);
    });

    socket.on("compileCode", async (payload) => {
        // Same guard as languageChange: never destructure in the signature.
        const input = payload && typeof payload === 'object' ? payload.input : undefined;
        const roomId = socket.currentRoom;
        if (!roomId || !rooms.has(roomId)) return;
        const room = rooms.get(roomId);

        // Interview rooms: the candidate may only run sample code while running.
        if (room.interview) {
            const iv = room.interview;
            const isCandidate = iv.candidateSocketId === socket.id;
            if (isCandidate && iv.status !== 'running') return;
        }

        if (room.running) return;

        const code = room.ydoc.getText("monaco").toString();
        if (typeof code !== 'string' || code.length > MAX_CODE) return;

        const now = Date.now();
        const lastRun = socket.lastCompileTime || 0;
        if (now - lastRun < 3000) {
            socket.emit("codeResponse", { run: { output: "Please wait a few seconds before running again." } });
            return;
        }
        socket.lastCompileTime = now;

        room.running = true;
        io.to(roomId).emit("codeRunning");

        const userName = socket.currentUser;
        try {
            const output = await runOnWandbox(room.language, code, input);
            if (room.recording) {
                recordEvent(room.recording, {
                    t: Date.now() - room.recording.startedAt,
                    k: 'run',
                    u: userName,
                    out: String(output).slice(0, 5000),
                });
            }
            io.to(roomId).emit("codeResponse", { run: { output } });
        } catch (err) {
            const msg = err?.response?.data?.message || err.message;
            console.error("compileCode failed:", msg);
            const out = `Execution failed: ${msg}`.slice(0, 5000);
            if (room.recording) {
                recordEvent(room.recording, {
                    t: Date.now() - room.recording.startedAt,
                    k: 'run',
                    u: userName,
                    out,
                });
            }
            io.to(roomId).emit("codeResponse", { run: { output: out } });
        } finally {
            room.running = false;
        }
    });
        

    socket.on("disconnect", () => {
        console.log("User disconnected", socket.id);
        leave(socket);
    });

    socket.on("leave-room", () => {
        leave(socket);
    });

});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
registerApiRoutes({
    app,
    rooms,
    finishedRecordings,
    finishedInterviews,
    buildInterviewReport,
    staticRoot: path.join(__dirname, '../Frontend/dist'),
});

server.listen(port, () => {
    console.log(`PairPad server is running on port ${port}`);
});
