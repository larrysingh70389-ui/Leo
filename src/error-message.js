export function publicErrorMessage(error) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  return message
    .replace(/Bearer\s+[^\s'"]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
    .replace(/((?:api[_-]?key|token)\s*[=:]\s*)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 1800);
}
