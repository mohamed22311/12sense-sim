/**
 * Where the simulator talks to.
 *
 * REST defaults to the same-origin path `/api/v1`, which Vite's dev proxy
 * forwards to the deployment — the deployed server has no CORS middleware, so
 * a browser cannot call it cross-origin (design doc §3.1). Once the server
 * ships CORSMiddleware, point VITE_API_BASE_URL straight at it and the proxy
 * stops mattering.
 *
 * WebSockets are exempt from CORS, so they go direct and always have.
 */
const DEPLOYED_WS = 'wss://tw-edf7c6f5a5ca428b807c34c7ebf9321f.ecs.us-east-1.on.aws/api/v1/ws';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
export const WS_URL = import.meta.env.VITE_WS_URL ?? DEPLOYED_WS;
