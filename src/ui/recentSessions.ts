/**
 * The companies this browser has started, so you can rejoin one by clicking.
 *
 * Deliberately a convenience and nothing more. Everything needed to resume is
 * derivable from the admin username alone — the slug gives every worker's
 * credentials, the company name gives the site — so this list only saves
 * typing. Clearing it, or opening the simulator on a different machine, costs
 * you nothing but a slug you can read off the dispatcher.
 *
 * It therefore stores **no password**. A demo tenant shares one owner-ruled
 * literal, but writing it into local storage would make a browser profile the
 * thing that grants access to a live tenant, which is a bad trade for saving
 * one field.
 */

const KEY = 'twelvesense.recentSessions.v1';
const MAX = 6;

export type RecentSession = {
  slug: string;
  adminUsername: string;
  companyName: string;
  siteId: 'factory' | 'construction';
  workerCount: number;
  /** epoch ms; only used for ordering and for showing how old it is */
  lastUsed: number;
};

function read(): RecentSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validated rather than trusted: this is user-writable storage that has
    // outlived at least one shape already, and a malformed entry would
    // otherwise render as an undefined slug on the setup screen.
    return parsed.filter(
      (entry): entry is RecentSession =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as RecentSession).slug === 'string' &&
        typeof (entry as RecentSession).adminUsername === 'string',
    );
  } catch {
    return [];
  }
}

export function recentSessions(): RecentSession[] {
  return read().sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
}

export function rememberSession(entry: Omit<RecentSession, 'lastUsed'>): void {
  try {
    const others = read().filter((s) => s.slug !== entry.slug);
    const next = [{ ...entry, lastUsed: Date.now() }, ...others].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing, a full quota, or storage disabled entirely. The
    // simulator works without this list; losing it must never block a demo.
  }
}

export function forgetSession(slug: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(read().filter((s) => s.slug !== slug)));
  } catch {
    /* see above */
  }
}
