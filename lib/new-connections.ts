// Shared definition of a "new connection" — a contact or relationship link
// created within this rolling window. Used by the /api/new-connections endpoint
// (server) and the dashboard widget / contact pages (client) so the threshold
// stays in one place.
export const NEW_CONNECTION_WINDOW_DAYS = 7;

const WINDOW_MS = NEW_CONNECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// True when `createdAt` falls inside the new-connection window. Tolerant of
// null/undefined/unparseable input (returns false) so callers can pass raw
// API values directly.
export function isNewConnection(
  createdAt: string | Date | null | undefined
): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= WINDOW_MS;
}
