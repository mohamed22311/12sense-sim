// Fails if a vendored copy has drifted from the mobile repo. Compares content
// ignoring the provenance header the copy carries. Stubs are listed as
// deliberate exceptions — they are not copies and must not be compared.
//
// This script only checks drift for files it already knows about (COPIES).
// A brand-new file dropped into src/phone/vendor/ — say, someone adding a
// vendored module by hand without updating this list — is invisible to that
// check and would sail through untested and undetected. The reverse scan
// below closes that hole: every .ts file under src/phone/vendor/ (other than
// __tests__/) must be accounted for, either as a COPY or as a named STUB.
//
// WARNING: this script proves the local copy matches whatever is checked out
// at MOBILE_SRC right now — nothing more. If MOBILE_SRC's working tree is
// dirty (uncommitted local edits, a cherry-pick in progress, etc.) rather
// than a clean checkout of EXPECTED_COMMIT, re-copying from it will make this
// check pass while the vendored file no longer matches the pinned commit at
// all. Always verify the mobile repo is clean and on EXPECTED_COMMIT before
// trusting a re-copy.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Every provenance header in this repo cites this commit. The comparison
// below reads whatever is checked out at MOBILE_SRC's working tree — so
// without a guard, a mobile-repo checkout on a DIFFERENT branch would still
// print a clean "N vendored files match" while quietly proving nothing about
// @15b11d4. Pin the default location to that commit; an explicit MOBILE_SRC
// override is trusted as-is (that escape hatch is what lets this script's own
// drift-detection be tested, by pointing it at a deliberately-altered copy).
const EXPECTED_COMMIT = '15b11d4';
const DEFAULT_MOBILE_SRC = '../../TwelveSense-TT-MobileApp/Thalamus/src';
const usingDefaultLocation = process.env.MOBILE_SRC === undefined;

const MOBILE = process.env.MOBILE_SRC ?? DEFAULT_MOBILE_SRC;

/*
  This repo is a deployment mirror: the mobile checkout the copies are compared
  against does not sit beside it. Skipping loudly beats failing, because a
  drift check that cannot see its source proves nothing either way — and a
  script that is always red here would train people to ignore it in the repo
  where it genuinely works.
*/
if (usingDefaultLocation && !existsSync(MOBILE)) {
  console.log(
    `check:vendor skipped — no mobile checkout at ${DEFAULT_MOBILE_SRC}. ` +
      'That is expected in the deployment mirror; run it in ' +
      'TwelveSense-TT-SimData, where the mobile repo sits alongside.',
  );
  process.exit(0);
}



const COPIES = [
  ['src/api/types.ts', 'api/types.ts'],
  ['src/phone/vendor/realtime/proximity.ts', 'realtime/proximity.ts'],
  ['src/phone/vendor/realtime/socket.ts', 'realtime/socket.ts'],
  ['src/phone/vendor/realtime/alertDedup.ts', 'realtime/alertDedup.ts'],
  ['src/phone/vendor/realtime/eventLifecycle.ts', 'realtime/eventLifecycle.ts'],
  ['src/phone/vendor/context/modality.ts', 'context/modality.ts'],
  ['src/phone/vendor/context/modalityDelivery.ts', 'context/modalityDelivery.ts'],
  ['src/phone/vendor/context/ambientContext.ts', 'context/ambientContext.ts'],
  ['src/phone/vendor/health/risk.ts', 'health/risk.ts'],
  ['src/phone/vendor/health/vitals.ts', 'health/vitals.ts'],
  ['src/phone/vendor/health/alerting.ts', 'health/alerting.ts'],
  ['src/phone/vendor/health/baseline.ts', 'health/baseline.ts'],
];

// Intentional stubs under src/phone/vendor/ — not copies of mobile-repo code,
// so they are never drift-compared, but they still must be named here or the
// reverse scan below will fail on them as "unlisted".
const STUBS = ['src/phone/vendor/health/poller.ts', 'src/phone/vendor/health/healthConnect.ts'];

const VENDOR_DIR = 'src/phone/vendor';

/** Recursively list every .ts file under `dir`, skipping `__tests__` folders. */
function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Drop a leading `/* VENDORED ... *\/` block so the header is not a diff. */
const stripHeader = (s) => s.replace(/^\/\* VENDORED[\s\S]*?\*\/\r?\n/, '');
const normalize = (s) => stripHeader(s).replace(/\r\n/g, '\n').trimEnd();

if (usingDefaultLocation) {
  let head;
  try {
    head = execFileSync('git', ['-C', MOBILE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch (err) {
    console.error(
      `Could not read the mobile repo's checked-out commit at ${MOBILE}.\n` +
        `Every vendored file's provenance header cites ${EXPECTED_COMMIT} — this check\n` +
        `only means something if that repo is actually checked out there.\n${err.message}`,
    );
    process.exit(1);
  }
  if (!head.startsWith(EXPECTED_COMMIT)) {
    console.error(
      `Mobile repo commit mismatch at ${MOBILE}:\n` +
        `  expected ${EXPECTED_COMMIT} (what every provenance header cites)\n` +
        `  found    ${head.slice(0, 7)}\n` +
        `Check out ${EXPECTED_COMMIT} there before trusting a green result, or point\n` +
        `MOBILE_SRC at a checkout that is on it.`,
    );
    process.exit(1);
  }
}

let drifted = 0;
for (const [local, upstream] of COPIES) {
  const upstreamPath = `${MOBILE}/${upstream}`;
  if (!existsSync(upstreamPath)) {
    console.error(`MISSING UPSTREAM  ${upstreamPath}`);
    drifted++;
    continue;
  }
  if (normalize(readFileSync(local, 'utf8')) !== normalize(readFileSync(upstreamPath, 'utf8'))) {
    console.error(`DRIFTED  ${local}  !=  ${upstreamPath}`);
    drifted++;
  }
}

// Reverse scan: every .ts file actually present under src/phone/vendor/ must
// be a known COPY or a named STUB. An unlisted file (e.g. a new vendored
// module copied in by hand but never added to COPIES) would otherwise be
// invisible to the drift check above.
const knownVendorCopies = new Set(COPIES.map(([local]) => local).filter((p) => p.startsWith(`${VENDOR_DIR}/`)));
const knownStubs = new Set(STUBS);
let unlisted = 0;
for (const file of listTsFiles(VENDOR_DIR)) {
  const normalized = file.replace(/\\/g, '/');
  if (knownVendorCopies.has(normalized) || knownStubs.has(normalized)) continue;
  console.error(`UNLISTED VENDOR FILE  ${normalized}  (add it to COPIES or STUBS in scripts/check-vendor.mjs)`);
  unlisted++;
}

if (drifted > 0 || unlisted > 0) {
  if (drifted > 0) console.error(`\n${drifted} vendored file(s) drifted. Re-copy them; do not edit them.`);
  if (unlisted > 0) console.error(`\n${unlisted} vendored file(s) unlisted.`);
  process.exit(1);
}
console.log(`${COPIES.length} vendored files match the mobile repo.`);
