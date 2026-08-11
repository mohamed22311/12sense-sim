/**
 * Who the last alert actually reached, and why the rest did not.
 *
 * This is the demo's whole argument and it used to be invisible: sixty phones
 * each ran the gate on their own floor and position, and the only way to see
 * the result was to query the server afterwards with a token and a curl. The
 * most striking fact — that a worker four metres from a machine can correctly
 * hear nothing because they are a storey above it — was something you had to
 * be told rather than shown.
 *
 * The split is by *reason*, not by a single count, because "too far" and
 * "wrong floor" are different stories. The second is the one that surprises
 * people, and burying it in a total throws away the point.
 */

export type ReachBreakdown = {
  /** phones that received the broadcast at all */
  received: number;
  /** phones whose own gate decided to alarm */
  alarmed: number;
  /** gated out because the alert names a different floor */
  wrongFloor: number;
  /** gated out on distance */
  tooFar: number;
  /** the closest phone that did NOT alarm, in metres — the striking number */
  nearestSilent: number | null;
};

export function ReachPanel({ reach }: { reach: ReachBreakdown }) {
  const silent = reach.wrongFloor + reach.tooFar;

  return (
    <section className="hud-card">
      <h2 className="hud-card-title">Alert reach</h2>

      <p className="reach-headline">
        <span className="reach-alarmed">{reach.alarmed}</span>
        <span className="reach-of">of {reach.received} alarmed</span>
      </p>

      <ul className="reach-rows">
        <li className="reach-row is-alarmed">
          <span className="reach-count">{reach.alarmed}</span>
          <span className="reach-label">alarmed</span>
        </li>
        {reach.wrongFloor > 0 && (
          <li className="reach-row">
            <span className="reach-count">{reach.wrongFloor}</span>
            <span className="reach-label">on another floor</span>
          </li>
        )}
        {reach.tooFar > 0 && (
          <li className="reach-row">
            <span className="reach-count">{reach.tooFar}</span>
            <span className="reach-label">beyond the radius</span>
          </li>
        )}
      </ul>

      {/*
        The line worth saying out loud. Only shown when a silent phone is
        genuinely close, because "the nearest silent worker was 60 m away" is
        not surprising and would dilute the times it is.
      */}
      {reach.nearestSilent !== null && reach.nearestSilent < 15 && silent > 0 && (
        <p className="reach-note">
          The nearest worker who did <strong>not</strong> alarm was{' '}
          <strong>{reach.nearestSilent.toFixed(1)} m</strong> away. Their phone
          decided that itself, from its own floor.
        </p>
      )}
    </section>
  );
}
