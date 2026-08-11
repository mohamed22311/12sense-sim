/**
 * The snooze durations the app offers, and how it words them.
 *
 * Copied from `Thalamus/src/data/alerts.ts` rather than vendored, because it is
 * presentation data and not a decision module — `npm run check:vendor` would
 * have nothing to enforce, since nothing here changes what the server records.
 * What matters is the *set*: a watch close-up that offered 5/15/60 while the
 * handset offers 1/2/5/10/15/30 would be showing an interface that does not
 * exist.
 *
 * Five minutes is the app's default and the comment there explains why it
 * moved: two minutes is shorter than it takes to finish the task a worker
 * snoozes *in order* to finish, so the re-alert landed mid-job and read as
 * nagging.
 */

export type SnoozeOption = { m: number; label: string };

export const SNOOZE_OPTS: readonly SnoozeOption[] = [
  { m: 1, label: '1 minute' },
  { m: 2, label: '2 minutes' },
  { m: 5, label: '5 minutes' },
  { m: 10, label: '10 minutes' },
  { m: 15, label: '15 minutes' },
  { m: 30, label: '30 minutes' },
];

export const DEFAULT_SNOOZE_MINS = 5;

/** The app's compact form, for the confirm button. */
export const snoozeLabel = (m: number): string => (m >= 60 ? `${m / 60}h` : `${m}m`);
