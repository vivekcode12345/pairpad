import path from 'path';
import express from 'express';
import crypto from 'crypto';

import {
    REPLAY_RATE_MAX,
    REPLAY_RATE_WINDOW_MS,
    ICE_RATE_MAX,
    ICE_RATE_WINDOW_MS,
    TURN_URLS,
    TURN_SECRET,
    TURN_USERNAME,
    TURN_CREDENTIAL,
    TURN_CREDENTIAL_TTL_MS,
} from '../config/constants.js';
import { timingSafeEqualStr } from '../utils/validation.js';

export function registerApiRoutes({ app, rooms, finishedRecordings, finishedInterviews, buildInterviewReport, staticRoot }) {
    const replayHits = new Map();
    const iceHits = new Map();

    const makeRateLimiter = (hitsMap, max, windowMs) => (req) => {
        const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
        const now = Date.now();
        let hits = hitsMap.get(ip) || [];
        hits = hits.filter((timestamp) => now - timestamp < windowMs);
        if (hits.length === 0) hitsMap.delete(ip);
        if (hits.length >= max) {
            hitsMap.set(ip, hits);
            return {
                allowed: false,
                retryAfter: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)),
            };
        }
        hits.push(now);
        hitsMap.set(ip, hits);
        return { allowed: true, retryAfter: 0 };
    };

    const allowReplayRequest = makeRateLimiter(replayHits, REPLAY_RATE_MAX, REPLAY_RATE_WINDOW_MS);
    const allowIceRequest = makeRateLimiter(iceHits, ICE_RATE_MAX, ICE_RATE_WINDOW_MS);

    app.get('/api/ice-config', (req, res) => {
        if (!allowIceRequest(req).allowed) {
            return res.status(429).json({ error: 'Too many requests' });
        }

        const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

        if (TURN_URLS && TURN_URLS.length > 0) {
            let username, credential;
            if (TURN_SECRET) {
                // Mint short-lived TURN credentials.
                const expiry = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_MS / 1000;
                username = String(expiry);
                const hmac = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
                credential = hmac;
            } else if (TURN_USERNAME && TURN_CREDENTIAL) {
                username = TURN_USERNAME;
                credential = TURN_CREDENTIAL;
            } else {
                // TURN_URLS set but no credentials: return STUN only.
                username = null;
                credential = null;
            }

            if (username && credential) {
                iceServers.push({
                    urls: TURN_URLS,
                    username,
                    credential,
                });
            }
        }

        res.set('Cache-Control', 'no-store');
        return res.json({ iceServers });
    });

    app.get('/api/replay/:roomId', (req, res) => {
        const limit = allowReplayRequest(req);
        if (!limit.allowed) return res.set('Retry-After', String(limit.retryAfter)).status(429).json({ error: 'Too many requests' });
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
        const limit = allowReplayRequest(req);
        if (!limit.allowed) return res.set('Retry-After', String(limit.retryAfter)).status(429).json({ error: 'Too many requests' });
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
