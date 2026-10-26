import path from 'path';
import express from 'express';

import {
    REPLAY_RATE_MAX,
    REPLAY_RATE_WINDOW_MS,
} from '../config/constants.js';
import { timingSafeEqualStr } from '../utils/validation.js';

export function registerApiRoutes({ app, rooms, finishedRecordings, finishedInterviews, buildInterviewReport, staticRoot }) {
    const replayHits = new Map();

    const allowRequest = (req) => {
        const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
        const now = Date.now();
        let hits = replayHits.get(ip) || [];
        hits = hits.filter((timestamp) => now - timestamp < REPLAY_RATE_WINDOW_MS);
        if (hits.length >= REPLAY_RATE_MAX) {
            replayHits.set(ip, hits);
            return false;
        }
        hits.push(now);
        replayHits.set(ip, hits);
        return true;
    };

    app.get('/api/replay/:roomId', (req, res) => {
        if (!allowRequest(req)) return res.status(429).json({ error: 'Too many requests' });
        const { roomId } = req.params;
        if (typeof roomId !== 'string' || roomId.length < 1 || roomId.length > 100) {
            return res.status(400).json({ error: 'Invalid room id' });
        }

        let recording = rooms.get(roomId)?.recording || null;
        if (!recording) recording = finishedRecordings.get(roomId);
        if (!recording) return res.status(404).json({ error: 'No recording found' });

        res.set('Cache-Control', 'no-store');
        return res.json({
            roomId: recording.roomId,
            startedAt: recording.startedAt,
            endedAt: recording.endedAt,
            truncated: recording.truncated,
            events: recording.events,
        });
    });

    app.get('/api/interview/:roomId/report', (req, res) => {
        if (!allowRequest(req)) return res.status(429).json({ error: 'Too many requests' });
        const { roomId } = req.params;
        if (typeof roomId !== 'string' || roomId.length < 1 || roomId.length > 100) {
            return res.status(400).json({ error: 'Invalid room id' });
        }

        const live = rooms.get(roomId);
        let report = null;
        let status = null;
        if (live && live.interview) {
            status = live.interview.status;
            report = buildInterviewReport(roomId, live);
        } else {
            report = finishedInterviews.get(roomId) || null;
        }
        if (!report) return res.status(404).json({ error: 'Interview not found' });

        const expectedKey = live?.interview?.interviewerKey || report._interviewerKey || null;
        const provided = req.get('x-interviewer-key');
        if (typeof provided !== 'string' || !provided.length || !expectedKey
            || !timingSafeEqualStr(provided, expectedKey)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (status && status !== 'ended') return res.status(409).json({ error: 'Interview not finished' });
        if (!status && report.endedAt === null) return res.status(409).json({ error: 'Interview not finished' });

        const { _interviewerKey, ...clean } = report;
        res.set('Cache-Control', 'no-store');
        return res.json(clean);
    });

    app.use(express.static(staticRoot));
    app.get('/*splat', (req, res) => {
        res.sendFile(path.join(staticRoot, 'index.html'));
    });
}
