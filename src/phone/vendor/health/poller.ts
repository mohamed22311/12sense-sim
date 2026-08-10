/* STUB for a vendored dependency — not a copy.
 * `alerting.ts` imports POLL_INTERVAL_MS from the app's vitals poller, an Expo
 * foreground-service shell the simulator does not have. Only the constant is
 * read, and it is reproduced verbatim so `ALERT_CONFIG.latchMaxAgeMs`
 * (= recoveryTicks × this) keeps the value the app computes.
 * Source of the value: Thalamus/src/health/poller.ts @ 15b11d4
 */
export const POLL_INTERVAL_MS = 60_000;
