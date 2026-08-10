// scripts/probe-registration.mjs
// Throwaway probe: does the deployed server accept a synthetic email domain?
// Registers one company, then one worker, then stops. Leaves a dead tenant
// behind — that is expected and is why this runs once, by hand.
const BASE = 'https://tw-edf7c6f5a5ca428b807c34c7ebf9321f.ecs.us-east-1.on.aws/api/v1';
const slug = `probe${Date.now().toString(36)}`;

const post = async (path, body, token) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const company = await post('/companies/register', {
  company_name: `Probe ${slug}`,
  admin: {
    username: `${slug}-admin`,
    email: `admin@${slug}.sim.twelvesenses.io`,
    password: 'ProbePass123',
    first_name: 'Probe',
    last_name: 'Admin',
  },
});
console.log('company:', company.status, JSON.stringify(company.body).slice(0, 300));
if (company.status !== 201) process.exit(1);

const code = await post(
  '/enrollment-codes',
  { type: 'join', max_uses: null, expires_at: null },
  company.body.access_token,
);
console.log('code:', code.status, JSON.stringify(code.body).slice(0, 200));
if (code.status !== 201) process.exit(1);

const worker = await post('/auth/register', {
  code: code.body.code,
  username: `${slug}-w01`,
  email: `w01@${slug}.sim.twelvesenses.io`,
  password: 'ProbePass123',
  first_name: 'Probe',
  last_name: 'Worker',
  date_of_birth: '1990-05-12',
  gender: 'male',
});
console.log('worker:', worker.status, JSON.stringify(worker.body).slice(0, 300));
process.exit(worker.status === 201 ? 0 : 1);
