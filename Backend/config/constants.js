export const WANDBOX_COMPILERS = {
    javascript: 'nodejs-20.17.0',
    python: 'cpython-3.12.7',
    cpp: 'gcc-13.2.0',
    java: 'openjdk-jdk-21+35',
};

export const MAX_CODE = 100000;
export const MAX_UPDATE_BYTES = 200000;

export const MAX_EVENTS = (() => {
    const n = parseInt(process.env.REPLAY_MAX_EVENTS, 10);
    return Number.isFinite(n) && n > 0 ? n : 20000;
})();
export const MAX_RECORDING_BYTES = 5_000_000;
export const MAX_FINISHED = 30;
export const FINISHED_TTL_MS = 24 * 60 * 60 * 1000;
export const REPLAY_RATE_MAX = (() => {
    const n = parseInt(process.env.REPLAY_RATE_MAX, 10);
    return Number.isFinite(n) && n > 0 ? n : 20;
})();
export const REPLAY_RATE_WINDOW_MS = (() => {
    const n = parseInt(process.env.REPLAY_RATE_WINDOW_MS, 10);
    return Number.isFinite(n) && n > 0 ? n : 60000;
})();

export const MAX_SUBMISSIONS = (() => {
    const n = parseInt(process.env.INTERVIEW_MAX_SUBMISSIONS, 10);
    return Number.isFinite(n) && n > 0 ? n : 5;
})();
export const SUBMIT_COOLDOWN_MS = (() => {
    const n = parseInt(process.env.INTERVIEW_SUBMIT_COOLDOWN_MS, 10);
    return Number.isFinite(n) && n >= 0 ? n : 15000;
})();
export const GRACE_MS = (() => {
    const n = parseInt(process.env.INTERVIEW_GRACE_MS, 10);
    return Number.isFinite(n) && n > 0 ? n : 600000;
})();
export const JUDGE_TIMEOUT_MS = (() => {
    const n = parseInt(process.env.INTERVIEW_JUDGE_TIMEOUT_MS, 10);
    return Number.isFinite(n) && n > 0 ? n : 40000;
})();
export const MAX_FINISHED_INTERVIEWS = 30;
export const FINISHED_INTERVIEW_TTL_MS = 24 * 60 * 60 * 1000;
export const ALLOWED_DURATIONS_MIN = [15, 30, 45, 60, 90];
export const MAX_INTERVIEW_DURATION_MS = Math.max(...ALLOWED_DURATIONS_MIN) * 60 * 1000;
export const ALLOW_SHORT = process.env.INTERVIEW_ALLOW_SHORT === '1';
export const JUDGE_MAX_ATTEMPTS = 3;
