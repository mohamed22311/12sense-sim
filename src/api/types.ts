/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/api/types.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
/**
 * REST + WebSocket payload types.
 *
 * SOURCE OF TRUTH: `docs/api-contract.md` (and, once the server exists, its
 * generated OpenAPI). Per Constitution VII ("One Contract, Not Two"), these are
 * a faithful mirror of that contract — do NOT invent or diverge shapes here.
 * A contract change happens server-side first, then is reflected in the doc,
 * then here.
 */

// --- Enums (api-contract.md → "Shared schemas / Enums") ---
export type EventSource = 'salesforce' | 'sap' | 'servicenow' | 'sim';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type ResponseAction =
  | 'received'
  | 'popped'
  | 'ignored_out_of_range'
  | 'ack'
  | 'snooze'
  | 'reject'
  | 'auto_cancelled'
  /**
   * Written by the SERVER when it fires a snooze re-alert (S3-BE13) — the phone
   * never sends it. Listed here because it can come back in a history row's
   * audit and the enum must match the live server's, whose `ResponseAction`
   * carries it (verified against `/openapi.json`, 2026-07-31).
   */
  | 'reminder_sent';
export type ResponseState =
  | 'pending'
  | 'received'
  | 'acknowledged'
  | 'snoozed'
  | 'rejected'
  | 'cancelled';
export type RiskBand = 'normal' | 'caution' | 'danger';
export type EventStatus = 'open' | 'resolved';
export type Modality = { visual: boolean; haptic: boolean; sound: boolean };

// --- Group alert broadcast (api-contract.md → "Event") ---
export type ApiEvent = {
  id: string;
  source: EventSource;
  asset_id: string;
  asset_label: string;
  latitude: number;
  longitude: number;
  /** used for the ON-DEVICE proximity decision (Constitution I) */
  alert_radius_m: number;
  /**
   * Level identifier, e.g. "2" | "B1" | "ground". null ⇒ the event is not
   * floor-specific (single-level site) and the floor gate is skipped.
   * The current server build may omit the key entirely — the gate normalizes
   * a missing value to null (same skip behavior).
   */
  floor?: string | null;
  /** finer named area — carried for future zone-level gating, NOT gated in MVP */
  zone_id?: string | null;
  severity: Severity;
  type: string;
  message: string;
  status: 'open' | 'resolved';
  created_at: string; // ISO-8601 UTC
};

// --- Group-alert list (GET /group-alerts — server S3-BE12, live 2026-07-31) ---

/**
 * The caller's own response to one group alert. `null` on the item below means
 * **no row exists at all**, which is NOT `state = "pending"`: the server never
 * fanned this alert out to this worker (they were not connected at the time).
 */
export type GroupAlertMyResponse = {
  state: ResponseState;
  /** the proximity verdict THIS phone reported: popped ⇒ true, ignored ⇒ false */
  in_range: boolean | null;
  distance_m: number | null;
  /** when the server will fire the snooze re-alert (S3-BE13) */
  snoozed_until: string | null;
  received_at: string | null;
  responded_at: string | null;
  ack_latency_s: number | null;
};

/**
 * The delivery this worker's phone reported for one group alert — the modality
 * it chose and the context it sensed, read back from the append-only
 * `response_events` audit (server S3-BE12).
 *
 * A **sibling** of `my_response` rather than a field inside it, because one
 * reads the audit and the other reads current state. Populated from the
 * **latest** `popped` row: a snooze re-alert re-senses, and the "Why this
 * alert?" panel has to explain the delivery in front of the worker, not the
 * first one. `null` when there is no `popped` row — never fanned out, suppressed
 * out of range, or the report was lost — which is a normal state the panel
 * already renders as *No context recorded*.
 *
 * `context_snapshot` is opaque passthrough: exactly the object the phone POSTed,
 * with whatever keys it had.
 */
export type GroupAlertMyDelivery = {
  /** when the phone showed it — every age in the snapshot is relative to this */
  occurred_at: string;
  modality: Modality | null;
  context_snapshot: Record<string, unknown> | null;
};

/**
 * One row of `GET /group-alerts`. Note this is NOT an `ApiEvent`: the geo
 * fields are nullable here (the broadcast shape guarantees them), which is why
 * `resync.ts` maps it explicitly rather than casting.
 */
export type GroupAlertHistoryItem = {
  id: string;
  source: EventSource;
  asset_id: string;
  asset_label: string | null;
  latitude: number | null;
  longitude: number | null;
  alert_radius_m: number | null;
  floor: string | null;
  zone_id: string | null;
  severity: Severity;
  type: string;
  message: string;
  status: EventStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  my_response: GroupAlertMyResponse | null;
  /** what this phone reported showing, and the context it sensed (S3-BE12) */
  my_delivery: GroupAlertMyDelivery | null;
  /**
   * The server's explicit "this event cannot be proximity-gated" marker — true
   * when any of latitude / longitude / alert_radius_m is missing. It exists so
   * the phone never has to infer intent from bare nulls: `ungated` ⇒ deliver
   * unconditionally rather than gate on a distance it cannot compute
   * (Constitution V).
   */
  ungated: boolean;
};

export type GroupAlertListResult = {
  items: GroupAlertHistoryItem[];
  next_cursor: string | null;
};

// --- Devices / FCM (api-contract.md → "REST — Devices (FCM)") ---
/**
 * POST /devices — register/refresh this phone's push token after login and on
 * token rotation (integration guide PART F3). Upsert server-side; the token is
 * tied to the logged-in worker automatically (no worker_id in the body).
 */
export type DeviceRegisterRequest = { fcm_token: string; platform: 'android' };
export type DeviceRegisterResult = { id: string; last_seen_at: string };

/**
 * FCM background "event" data message (integration guide PART F7). FCM data
 * messages are STRING-ONLY and FLATTENED — field names differ from ApiEvent
 * (event_id↔id, event_type↔type). Mapped back to an ApiEvent by
 * notifications/fcmEvent.ts. Mobile signed off on this shape (S2-MB6) and
 * requested the server also send asset_label, floor, created_at (Constitution
 * VII — the shape lands server-side first, then here).
 */
export type FcmEventMessage = {
  /**
   * `event` is a fresh broadcast; `event_reminder` is the server's targeted
   * snooze re-alert (S3-BE11), mirrored over FCM with the same field flattening
   * so it reaches a backgrounded or dozing phone whose socket is down. The
   * phone dedupes on `event_id` + `type` (api-contract.md), which is why
   * `alertDedup` keys its claims by both.
   */
  type: 'event' | 'event_reminder';
  event_id: string;
  /**
   * On an `event_reminder` only: the deadline that just expired — the **third**
   * component of the re-alert's dedupe key.
   *
   * The socket has always carried it; the push did not until server S3-BE14, so
   * the key collapsed to `(reminder, event_id)` — identical across every snooze
   * cycle of the same event — and the *second* reminder was dropped as a
   * duplicate of the first. That defeated the whole feature precisely on the
   * backgrounded phone the push exists to reach. Optional here because an
   * `event` never carries it.
   */
  snoozed_until?: string;
  asset_id: string;
  latitude: string;
  longitude: string;
  alert_radius_m: string;
  severity: string;
  event_type: string;
  message: string;
  // Shipped server-side (S3-BE14 completed the set), but still optional here:
  // FCM drops null values, so a legitimately floor-less event arrives without
  // the key, and the mapper has to handle that anyway.
  asset_label?: string;
  floor?: string;
  created_at?: string;
};

// --- Auth (api-contract.md → "REST — Auth") ---
export type Gender = 'male' | 'female' | 'prefer_not_to_say' | null;

export type RegisterRequest = {
  /**
   * The company enrollment code (S3-MB7). Required: the server is multi-tenant and
   * this is what resolves the worker's company — there is no company-less worker.
   */
  code: string;
  username: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  gender?: Gender;
  date_of_birth?: string | null;
  shift?: string | null;
};

export type LoginRequest = { username_or_email: string; password: string };

/**
 * Body for `PATCH /auth/me` (server S3-BE14) — the first way a worker can
 * correct anything about their own account.
 *
 * **Partial: an absent key leaves its column alone, and is NOT the same as
 * null.** `gender` and `date_of_birth` accept an explicit null and clear;
 * `first_name`, `last_name` and `username` reject null and empty strings with a
 * 422, because a worker who could blank their own name would undo the server's
 * "names are required" rule. Unknown keys are ignored rather than written, so
 * posting a whole form cannot change `role` or `company_id`.
 *
 * `email` is deliberately not editable — it is identity and account recovery,
 * not a profile field. Neither are `shift` and `job_title`, which the company
 * owns.
 */
export type ProfileUpdateRequest = {
  first_name?: string;
  last_name?: string;
  username?: string;
  gender?: Gender;
  date_of_birth?: string | null;
};

/** returned by register/login and GET /auth/me — passwords never included */
export type Worker = {
  id: string;
  /** the company this worker enrolled into; scopes every broadcast they receive (S3-MB7) */
  company_id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  gender: Gender;
  date_of_birth: string | null;
  shift: string | null;
  role: string;
  created_at: string;
};

// --- Enrollment codes (api-contract.md → "REST — Enrollment") ---

/**
 * The two kinds of code an admin can mint. A `join` code is reusable and creates a
 * brand-new worker; a `profile` code is one-time and claims a worker the admin
 * pre-created with their name/shift already filled in.
 */
export type EnrollmentCodeType = 'join' | 'profile';

/** What a `profile` code's pre-created worker already carries. */
export type EnrollmentPrefill = {
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  shift: string | null;
};

/**
 * `GET /enrollment-codes/lookup?code=` — **live** since server S3-BE14. Lets the
 * phone name the company and show a profile code's prefills *before* signup.
 *
 * Unauthenticated by necessity: it runs before the account that would
 * authenticate it exists. `404` for an unknown code, `410` for one already
 * expired, exhausted or claimed. Callers still treat every failure as "no
 * information" and carry on — `POST /auth/register` stays the only authority on
 * whether a code is good (Constitution V).
 *
 * Matching is **exact**, deliberately: register compares the same way, and a
 * lookup that blessed a case variant register then rejected would be worse than
 * no lookup. `normalizeCode` runs before both, so the phone sends one spelling.
 */
export type EnrollmentLookupResponse = {
  type: EnrollmentCodeType;
  company_name: string;
  profile: EnrollmentPrefill | null;
};

export type AuthResponse = {
  worker: Worker;
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
};

export type RefreshResponse = { access_token: string; token_type: 'bearer' };

// --- Group-alert response POST (api-contract.md → POST /events/{id}/responses) ---

// Proximity-gate vocabulary recorded in context_snapshot (S2-MB4). Declared here
// (not in realtime/) because the strings travel on the wire and are documented in
// the design doc's context_snapshot key list.
/** how the floor axis of the gate resolved */
export type FloorGate =
  | 'match'
  | 'mismatch'
  | 'skipped_null_event_floor' // event.floor == null ⇒ single-level site, gate skipped
  | 'fallback_unknown_worker_floor'; // worker floor not set ⇒ treated as a match
/** how the GPS/radius axis of the gate resolved */
export type GpsGate =
  | 'in_range'
  | 'out_of_range'
  | 'fallback_no_fix' // no usable position ⇒ treated as in range
  | 'fallback_stale_fix' // fix older than PROXIMITY_CONFIG.gpsStaleAfterMs (or clock-skewed into the future) ⇒ treated as in range
  | 'fallback_invalid_event_geo'; // event lat/lon/radius missing or out of range ⇒ can't measure distance ⇒ treated as in range
/** safe-fallback paths that fired during the decision (Constitution V: recorded, never silent) */
export type ProximityFallback =
  | 'unknown_worker_floor'
  | 'gps_unavailable'
  | 'gps_stale'
  | 'event_geo_invalid';

export type ContextSnapshot = {
  /** `still | moving | unknown` (S3-MB1) */
  motion?: string;
  /**
   * `quiet | loud | unknown` (S3-MB1). Declared here in S3-MB2 — the S3-MB1
   * senders spread an inferred object into `context_snapshot`, so the missing
   * declaration never surfaced; the key has been on the wire since S3-MB1 and
   * is documented in api-contract.md.
   */
  noise?: string;
  noise_db?: number;
  /**
   * `online | offline | unknown` — whether the phone had a usable connection at
   * delivery. Declared by the contract from the start; first POPULATED in
   * S3-MB2 (expo-network reading, see context/connection.ts).
   */
  connection?: string;
  /**
   * Age of the OLDEST context signal that fed the decision, seconds (S3-MB2).
   * Motion refreshes on the 60 s vitals poll and noise on the ~20 s mic loop,
   * so this reports the worst case — never the flattering newer reading.
   * Absent when neither axis could be measured.
   */
  freshness_s?: number;
  // Context-aware modality record (S3-MB1; jsonb keys are additive). The phone
  // mic yields only a level relative to full scale, so we carry raw `noise_dbfs`
  // + provenance and deliberately OMIT an absolute `noise_db` (no fabricated
  // SPL — see the design doc §5 / api-contract note).
  noise_dbfs?: number;
  noise_age_s?: number;
  noise_source?: string;
  // Alert context snapshot (S3-MB2; additive jsonb keys, same precedent).
  /** `still | moving | unknown` — kept alongside `motion` so ages are auditable */
  motion_age_s?: number;
  /** how the alert travelled: `ws | fcm | demo` */
  transport?: string;
  /** radio class at delivery: `wifi | cellular | none | unknown | …` */
  network?: string;
  /** the app's live WebSocket at delivery: `open | connecting | reconnecting | down | unknown` */
  live_channel?: string;
  /** radio reported usable internet (absent when the radio said nothing) */
  internet_reachable?: boolean;
  /** why this pop happened when not a fresh broadcast — 'snooze_reminder' on an event_reminder re-pop (S2-MB5; jsonb keys are additive) */
  reason?: string;
  // Proximity-gate record (S2-MB4) — distance_m stays a top-level request field.
  worker_floor?: string | null;
  event_floor?: string | null;
  floor_gate?: FloorGate;
  gps_gate?: GpsGate;
  gps_age_s?: number | null;
  fallbacks?: ProximityFallback[];
};

export type ResponsePostRequest = {
  client_event_id: string; // idempotency key
  /**
   * Every action the phone can report. `auto_cancelled` was excluded here until
   * S3-MB4: the gate discovered mid-decision that the event had already been
   * resolved (a teammate ACKed while we were waiting on a GPS fix) and reported
   * NOTHING after `received`, leaving a hole in the audit trail. `popped` and
   * `ignored_out_of_range` would both be lies — the alert was never shown, and
   * it was never out of range — so the phone now reports `auto_cancelled`, the
   * server's own word for a response voided before it landed. The live server's
   * `ResponseAction` enum already accepts it (verified against
   * `/openapi.json`, 2026-07-29), so this widens the client to the contract
   * rather than changing the contract (Constitution VII).
   */
  action: ResponseAction;
  occurred_at: string;
  snoozed_until?: string; // required iff action = 'snooze'
  distance_m?: number;
  modality?: Modality;
  context_snapshot?: ContextSnapshot;
};

export type ResponsePostResult = {
  event_id: string;
  worker_state: ResponseState;
  event_status: 'open' | 'resolved';
  resolved_by: string | null;
};

// --- Individual (health) alert POST (analytics only) ---
export type IndividualAlertRequest = {
  client_event_id: string;
  risk_band: 'caution' | 'danger';
  // Nullable/optional to match the server contract's safe-fallback semantics:
  // a sparse alert may omit or null these. HealthProvider always sends full
  // values, but the type must model what the backend accepts (api-contract.md).
  risk_score?: number | null;
  /** unsynced/unmeasured vitals are sent as null (design doc §5, S2-MB1) */
  vitals_snapshot?: Record<string, number | null> | null;
  reason?: string | null;
  raised_at: string;
  /**
   * Why this alert fired and how it was delivered — stored server-side as
   * opaque jsonb and echoed back verbatim on the history read (server S3-BE9).
   *
   * The phone owns all decision logic (Constitution I/III), so the server never
   * interprets, recomputes or "corrects" this. The app sends the `delivery`
   * compartment (`snapshotToTraceWire`); the contract's example sketches
   * `engine` / `rules` / `debounce` / `baseline` alongside it, and those can
   * follow later with no schema change — which is the point of storing it
   * opaquely.
   */
  decision_trace?: unknown;
};

/**
 * One row from `GET /individual-alerts` (api-contract.md → "GET
 * /individual-alerts", marked _proposal — pending impl_). Mirrored here so the
 * app's hydration path is written against the documented shape rather than an
 * invented one (Constitution VII); the server ships the endpoint first, and
 * until it does the client treats 404/405/501 as "not shipped" and falls back
 * to on-device history (S3-MB3).
 *
 * Every lifecycle field is optional/nullable: the contract derives them from
 * `POST /individual-alerts/{id}/events`, itself a pending proposal, so a first
 * implementation may omit them entirely.
 */
export type IndividualAlertState = 'raised' | 'viewed' | 'acknowledged' | 'auto_recovered';

export type ServerIndividualAlert = {
  id: string;
  risk_band: 'caution' | 'danger';
  risk_score?: number | null;
  vitals_snapshot?: Record<string, number | null> | null;
  reason?: string | null;
  /** opaque to the phone — the server stores the decision trace as jsonb */
  decision_trace?: unknown;
  raised_at: string;
  created_at?: string;
  state?: IndividualAlertState | null;
  viewed_at?: string | null;
  acknowledged_at?: string | null;
  acknowledged_via?: string | null;
  recovered_at?: string | null;
};

export type IndividualAlertListResult = {
  items: ServerIndividualAlert[];
  next_cursor?: string | null;
};

/** Which surface the worker acted on (api-contract.md → `individual_alert_surface`). */
export type IndividualAlertSurface = 'notification' | 'alarm_screen' | 'app_screen';

/**
 * Body for `POST /individual-alerts/{id}/events` (api-contract.md, marked
 * _proposal — pending impl_) — the append-only health-alert mirror of the
 * group-alert `response_events` pattern. Sent by the app from S3-MB4 so a
 * worker's "Got it — I'm resting" and an automatic recovery are recorded, not
 * just shown locally; until the server ships the endpoint the outbox classifies
 * its 404/405/501 as terminal and drops the record with a `__DEV__` log
 * (the same silent degradation S3-MB3 chose for `GET /individual-alerts`).
 *
 * `auto_recovered` carries `surface: null` — nobody pressed anything.
 */
export type IndividualAlertEventRequest = {
  client_event_id: string;
  action: 'viewed' | 'acknowledged' | 'auto_recovered';
  occurred_at: string;
  surface: IndividualAlertSurface | null;
};

// --- WebSocket server→client messages (api-contract.md → "WebSocket") ---
export type WsMessage =
  | { type: 'event'; event: ApiEvent }
  | { type: 'event_resolved'; event_id: string; resolved_by: string; resolved_at: string }
  // Targeted snooze re-alert (api-contract.md "event_reminder" — proposal,
  // pending backend impl): sent to THIS worker at snoozed_until iff the event
  // is still open and the worker is still snoozed. Carries the full Event so
  // the alert re-renders even after a process restart.
  | {
      type: 'event_reminder';
      event_id: string;
      reason: 'snooze_expired';
      snoozed_until: string;
      event: ApiEvent;
    }
  | { type: 'ping'; at: string };

// --- Error envelope ---
// Draft contract proposed { error: {...} }; the implemented server (FastAPI)
// returns { detail: "..." }. The client accepts both.
export type ApiErrorEnvelope = {
  error?: { code: string; message: string; details?: Record<string, unknown> };
  detail?: string;
};
