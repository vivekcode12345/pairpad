const MAX_ROOM_ID_LENGTH = 100;

function stripWrapping(value) {
  return value
    .trim()
    .replace(/^["'()[\]{}]+|["'()[\]{}]+$/g, '')
    .replace(/\/+$/, '')
    .trim();
}

export function normalizeRoomId(input) {
  let value = stripWrapping(String(input ?? ''));
  const hasQuery = /(?:\?|&)(?:replay|room|interview)=/i.test(value);
  const looksLikeUrl = /^[a-z][a-z\d+\-.]*:\/\//i.test(value);
  if (hasQuery || looksLikeUrl) {
    try {
      const url = new URL(value, window.location.origin);
      const parameter = ['replay', 'room', 'interview'].find((key) => url.searchParams.has(key));
      if (parameter) value = url.searchParams.get(parameter) || '';
    } catch {
      // Validation reports malformed input without throwing from form handlers.
    }
  }
  return stripWrapping(value);
}

export function validateRoomId(id) {
  if (!id) return { ok: false, message: 'Enter a room ID' };
  if (id.length > MAX_ROOM_ID_LENGTH) {
    return { ok: false, message: `That ID is too long (max ${MAX_ROOM_ID_LENGTH} characters)` };
  }
  if ([...id].some((character) => /\s/.test(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return { ok: false, message: 'Room IDs cannot contain spaces or special characters' };
  }
  return { ok: true };
}

export { MAX_ROOM_ID_LENGTH };
