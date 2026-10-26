import crypto from 'crypto';

export function toUpdateBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (Array.isArray(data) && data.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
        return Uint8Array.from(data);
    }
    return null;
}

export function generateKey() {
    return crypto.randomBytes(18).toString('base64url');
}

export function timingSafeEqualStr(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

export function normalizeForCompare(s) {
    const lines = String(s).split('\n').map((line) => line.replace(/\s+$/, ''));
    while (lines.length && lines[0] === '') lines.shift();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
}
