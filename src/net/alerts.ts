import { apiRequest } from '@/net/apiClient';
import type { MachineKind } from '@/sites/types';

/**
 * Raising an alert by hand.
 *
 * `POST /simulations/events` is the server's own demo endpoint: it runs a
 * hand-raised alert through the **real** pipeline — the same ingestion, the
 * same fan-out, the same ackable event id — rather than a shortcut that only
 * looks like one. So a machine pressed in the simulation produces an event the
 * phones receive over their real sockets, respond to with real acks, and that
 * `GET /analytics/summary` counts.
 *
 * It requires an admin token and takes the company from that token, never from
 * the body, so the simulator can only ever raise alerts into the tenant it
 * provisioned.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type RaiseAlertInput = {
  assetId: string;
  assetLabel: string;
  /**
   * The floor the asset is on. Sent because the phone's floor gate is one of
   * the decisions this demo exists to show — omitting it makes every alert
   * ungated, which is the less interesting half of the behaviour.
   */
  floor: string;
  severity: Severity;
  type: string;
  message: string;
  latitude: number;
  longitude: number;
  alertRadiusM: number;
};

/** What the server reports about who the alert reached. */
export type RaiseAlertResult = {
  event_id: string;
  inserted: boolean;
  delivered: number;
  pushed?: number;
  seeded?: number;
};

export async function raiseAlert(
  input: RaiseAlertInput,
  adminToken: string,
  signal?: AbortSignal,
): Promise<RaiseAlertResult> {
  return apiRequest<RaiseAlertResult>('POST', '/simulations/events', {
    token: adminToken,
    signal,
    body: {
      asset_id: input.assetId,
      asset_label: input.assetLabel,
      floor: input.floor,
      severity: input.severity,
      type: input.type,
      message: input.message,
      latitude: input.latitude,
      longitude: input.longitude,
      alert_radius_m: input.alertRadiusM,
    },
  });
}

/**
 * What the server says about an event now.
 *
 * Note the nesting: `GET /events/{id}` returns the event *inside* an envelope
 * alongside the response tallies, so the status is `event.status` and not a
 * top-level field. Typing it flat compiled perfectly and read `undefined`
 * forever, which meant every alert looked open and the panel never cleared —
 * a shape mistake that only a live call could catch.
 */
export type EventStatus = {
  event: { id: string; status: 'open' | 'resolved' | string };
  tracked: number;
  counts: { received: number; ack: number; snooze: number; reject: number };
};

/** True when the server still considers this event open. */
export function isEventOpen(status: EventStatus): boolean {
  return status.event.status !== 'resolved';
}

/**
 * Ask the server whether an event is still open.
 *
 * The console cannot know this on its own: an alert resolves when the *first*
 * worker acknowledges it, and that can be a phone in someone's hand rather
 * than a click in this window. Polling is the honest way to find out — without
 * it the alarm list is a record of what this browser raised, not of what is
 * actually open, and those two drift apart the moment anybody answers.
 */
export async function fetchEventStatus(
  eventId: string,
  adminToken: string,
  signal?: AbortSignal,
): Promise<EventStatus> {
  return apiRequest<EventStatus>('GET', `/events/${eventId}`, { token: adminToken, signal });
}

/**
 * The alert kinds a given machine can plausibly raise, **most severe first**.
 *
 * Per kind rather than one generic list, because the demo's whole point is
 * that a dispatcher reads a real message about a real asset — "Refrigerant
 * pressure high" from a chiller says something; "Simulated alert" says nothing.
 *
 * Severity-first because the first entry is what the dialog opens on, and so
 * what a hurried demonstrator sends. A critical alert is the one that drives
 * the phone's modality escalation all the way up, which is the behaviour worth
 * showing; a low-severity nudge demonstrates the least of the system.
 */
export const ALERT_TYPES: Record<
  MachineKind,
  ReadonlyArray<{ type: string; message: string; severity: Severity }>
> = {
  reactor: [
    { type: 'pressure', message: 'Vessel pressure above safe limit', severity: 'critical' },
    { type: 'temperature', message: 'Reaction temperature rising', severity: 'high' },
    { type: 'leak', message: 'Seal leak detected at the head flange', severity: 'high' },
  ],
  chiller: [
    { type: 'pressure', message: 'Refrigerant pressure high', severity: 'high' },
    { type: 'temperature', message: 'Cold room above set point', severity: 'medium' },
    { type: 'fault', message: 'Condenser fan failure', severity: 'medium' },
  ],
  panel: [
    { type: 'electrical', message: 'Earth fault on outgoing feeder', severity: 'critical' },
    { type: 'fault', message: 'Breaker tripped — supply lost', severity: 'high' },
    { type: 'maintenance', message: 'Panel due for thermographic survey', severity: 'low' },
  ],
  press: [
    { type: 'guard', message: 'Light curtain broken during stroke', severity: 'critical' },
    { type: 'hydraulic', message: 'Hydraulic pressure loss', severity: 'high' },
    { type: 'fault', message: 'Ram failed to return to top of stroke', severity: 'medium' },
  ],
  packer: [
    { type: 'fault', message: 'Conveyor drive overload', severity: 'high' },
    { type: 'jam', message: 'Carton jam at the infeed', severity: 'medium' },
    { type: 'maintenance', message: 'Roller bearing noise on the outfeed', severity: 'low' },
  ],
  furnace: [
    { type: 'temperature', message: 'Furnace over temperature', severity: 'critical' },
    { type: 'gas', message: 'Combustible gas detected at the burner', severity: 'critical' },
    { type: 'fault', message: 'Flame failure — burner locked out', severity: 'high' },
  ],

  // The construction site's plant. Different failures entirely: nothing here
  // is a process, and the hazard is nearly always to the people beside it.
  hoist: [
    { type: 'fall', message: 'Hoist gate open with the car in motion', severity: 'critical' },
    { type: 'overload', message: 'Hoist overloaded — car will not travel', severity: 'high' },
    { type: 'fault', message: 'Landing interlock fault', severity: 'high' },
  ],
  crane: [
    { type: 'wind', message: 'Wind speed above slewing limit', severity: 'critical' },
    { type: 'overload', message: 'Load moment exceeded — slew inhibited', severity: 'critical' },
    { type: 'fault', message: 'Anti-collision sensor unresponsive', severity: 'high' },
  ],
  generator: [
    { type: 'fuel', message: 'Fuel spill detected at the bund', severity: 'high' },
    { type: 'electrical', message: 'Earth leakage trip on the site supply', severity: 'high' },
    { type: 'fault', message: 'Generator shut down on low oil pressure', severity: 'medium' },
  ],
  pump: [
    { type: 'pressure', message: 'Delivery line blocked — pressure spiking', severity: 'critical' },
    { type: 'hydraulic', message: 'Hydraulic hose burst at the outrigger', severity: 'high' },
    { type: 'fault', message: 'Hopper level low — pump drawing air', severity: 'medium' },
  ],
  welder: [
    { type: 'fire', message: 'Hot works — smoke detected nearby', severity: 'critical' },
    { type: 'gas', message: 'Shielding gas bottle leaking', severity: 'high' },
    { type: 'fault', message: 'Welding set tripped on duty cycle', severity: 'low' },
  ],
};

/** The alert radius, in metres, the dialog opens on. */
export const DEFAULT_ALERT_RADIUS_M = 75;
