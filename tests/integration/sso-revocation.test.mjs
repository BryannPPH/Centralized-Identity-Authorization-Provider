import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const execFileAsync = promisify(execFile);

const AUTH = "http://localhost:3000";
const APP_A = "http://localhost:3001";
const APP_B = "http://localhost:3002";
const ADMIN = "http://localhost:3004";
const RABBITMQ = "http://127.0.0.1:15672";
const DOT_ENV = readDotEnv();
const DB_URL = process.env.TEST_DATABASE_URL ?? requireConfig("DATABASE_URL");
const APP_A_DB_URL = process.env.TEST_APP_A_DATABASE_URL ?? requireConfig("APP_A_DATABASE_URL");
const APP_B_DB_URL = process.env.TEST_APP_B_DATABASE_URL ?? requireConfig("APP_B_DATABASE_URL");
const PASSWORD = process.env.TEST_USER_PASSWORD ?? requireConfig("SEED_USER_PASSWORD");
const CLIENT_SECRET = process.env.TEST_CLIENT_SECRET ?? requireConfig("APP_CLIENT_SECRET");
const INTERNAL_LOGOUT_TOKEN =
  process.env.TEST_INTERNAL_LOGOUT_TOKEN ?? requireConfig("INTERNAL_LOGOUT_TOKEN");
const ADMIN_AUTH = `Basic ${Buffer.from(
  `${requireConfig("ADMIN_USERNAME")}:${requireConfig("ADMIN_PASSWORD")}`
).toString("base64")}`;

let client;
let appAClient;
let appBClient;
let appAGroup;
let appBGroup;
let appA;
let appB;
const tempUserIds = new Set();
const tempApplicationIds = new Set();

function readDotEnv() {
  try {
    const entries = new Map();

    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);

      if (!match) {
        continue;
      }

      entries.set(match[1], match[2].replace(/^["']|["']$/g, ""));
    }

    return entries;
  } catch {
    return new Map();
  }
}

function requireConfig(name) {
  const value = process.env[name] ?? DOT_ENV.get(name);

  if (!value) {
    throw new Error(`${name} is required for integration tests`);
  }

  return value;
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  header() {
    return [...this.cookies.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  store(headers) {
    const values =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : splitSetCookie(headers.get("set-cookie"));

    for (const value of values) {
      const [pair] = value.split(";");
      const index = pair.indexOf("=");

      if (index < 0) {
        continue;
      }

      const key = pair.slice(0, index).trim();
      const cookieValue = pair.slice(index + 1).trim();

      if (!key) {
        continue;
      }

      if (cookieValue === "") {
        this.cookies.delete(key);
      } else {
        this.cookies.set(key, cookieValue);
      }
    }
  }

  async fetch(url, options = {}) {
    const headers = new Headers(options.headers ?? {});
    const cookie = this.header();

    if (cookie) {
      headers.set("cookie", cookie);
    }

    const response = await fetch(url, {
      ...options,
      headers,
      redirect: options.redirect ?? "manual"
    });

    this.store(response.headers);

    return response;
  }
}

function splitSetCookie(value) {
  if (!value) {
    return [];
  }

  return value.split(/,(?=\s*[^;,\s]+=)/);
}

function redirectLocation(response) {
  const location = response.headers.get("location");

  assert.ok(location, `Expected redirect location from ${response.url}`);

  return new URL(location, response.url).toString();
}

function form(data) {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(data)) {
    body.set(key, value);
  }

  return body;
}

function codeChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function base32Decode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.toUpperCase().replaceAll("=", "").replace(/\s+/g, "");
  let bits = "";

  for (const character of normalized) {
    const index = alphabet.indexOf(character);

    if (index === -1) {
      throw new Error("Invalid base32 secret");
    }

    bits += index.toString(2).padStart(5, "0");
  }

  const bytes = [];

  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateTotpCode(secret, now = new Date()) {
  const counter = Math.floor(now.getTime() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

async function jsonRequest(url, options = {}) {
  const headers = new Headers(options.headers ?? {});

  if (url.startsWith(ADMIN) && !headers.has("authorization")) {
    headers.set("authorization", ADMIN_AUTH);
  }

  if (options.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${url} failed ${response.status}: ${text}`);
  }

  return data;
}

async function postJson(url, body, headers = {}) {
  return jsonRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

async function patchJson(url, body) {
  return jsonRequest(url, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

async function deleteJson(url) {
  return jsonRequest(url, {
    method: "DELETE"
  });
}

async function expectJsonStatus(response, status) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  assert.equal(response.status, status, text);

  return data;
}

async function loginAuth(jar, email, password = PASSWORD) {
  const response = await jar.fetch(`${AUTH}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form({ email, password })
  });

  return expectJsonStatus(response, 200);
}

async function loginMfa(jar, code) {
  const response = await jar.fetch(`${AUTH}/login/mfa`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ code })
  });

  return expectJsonStatus(response, 200);
}

async function authorize(jar, params) {
  const url = new URL(`${AUTH}/authorize`);

  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state ?? "test-state");
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  const response = await jar.fetch(url.toString());

  assert.ok(
    response.status >= 300 && response.status < 400,
    `Authorize should redirect, got ${response.status}`
  );

  return new URL(redirectLocation(response));
}

async function tokenRequest(body) {
  const response = await fetch(`${AUTH}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  return {
    response,
    data,
    text
  };
}

async function getAuthorizationCode(jar, clientId, redirectUri, verifier) {
  const location = await authorize(jar, {
    clientId,
    redirectUri,
    codeChallenge: codeChallenge(verifier)
  });

  assert.equal(location.origin + location.pathname, redirectUri);
  assert.ok(location.searchParams.get("code"), "Authorize redirect should contain code");

  return location.searchParams.get("code");
}

async function loginApp(jar, appBase, email, password = PASSWORD, mfaSecret) {
  let response = await jar.fetch(`${appBase}/login`);

  assert.ok(
    response.status >= 300 && response.status < 400,
    `App login should redirect from ${appBase}`
  );

  response = await jar.fetch(redirectLocation(response));

  assert.ok(
    response.status >= 300 && response.status < 400,
    `Authorize should redirect for ${appBase}, got ${response.status}`
  );

  let location = redirectLocation(response);
  const redirectUrl = new URL(location);

  if (redirectUrl.origin === new URL(AUTH).origin && redirectUrl.pathname === "/login") {
    const returnTo = redirectUrl.searchParams.get("returnTo");

    assert.ok(returnTo, "Auth login redirect should contain returnTo");

    const login = await loginAuth(jar, email, password);

    if (login.mfaRequired) {
      assert.ok(mfaSecret, "MFA secret is required for app login");
      await loginMfa(jar, generateTotpCode(mfaSecret));
    }

    response = await jar.fetch(new URL(returnTo, location).toString());

    assert.ok(
      response.status >= 300 && response.status < 400,
      `Authorize after login should redirect, got ${response.status}`
    );

    location = redirectLocation(response);
  }

  response = await jar.fetch(location);

  assert.ok(
    response.status >= 300 && response.status < 400,
    `Callback should redirect to app home, got ${response.status}: ${await response.text()}`
  );

  await expectAppActive(jar, appBase, `${appBase} after app login`);
}

async function expectAppActive(jar, appBase, label) {
  const response = await jar.fetch(`${appBase}/`);
  const text = await response.text();

  assert.equal(response.status, 200, label);
  assert.match(text, /Central session/, label);
}

async function expectAppLoggedOut(jar, appBase, label) {
  const response = await jar.fetch(`${appBase}/`);
  const text = await response.text();

  assert.equal(response.status, 200, label);
  assert.match(text, /Local session belum aktif/, label);
}

async function expectCentralActive(jar, label) {
  const response = await jar.fetch(`${AUTH}/session`);

  return expectJsonStatus(response, 200).catch((error) => {
    error.message = `${label}: ${error.message}`;
    throw error;
  });
}

async function expectCentralRevoked(jar, label) {
  const response = await jar.fetch(`${AUTH}/session`);

  assert.equal(response.status, 401, label);
}

async function waitFor(check, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`${label} timed out: ${lastError?.message ?? "unknown"}`);
}

async function createTempUser(groups, suffix) {
  const email = `test-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const user = await postJson(`${ADMIN}/admin/users`, {
    name: `Test ${suffix}`,
    email,
    password: PASSWORD,
    status: "ACTIVE"
  });

  tempUserIds.add(user.id);

  for (const group of groups) {
    await postJson(`${ADMIN}/admin/groups/${group.id}/users`, {
      userId: user.id
    });
  }

  return {
    ...user,
    email
  };
}

async function cleanupUser(userId) {
  const events = await client.query("select id from events where user_id = $1", [userId]);
  const eventIds = events.rows.map((row) => row.id);

  if (eventIds.length > 0) {
    await Promise.all([
      appAClient.query("delete from processed_events where event_id = any($1::uuid[])", [
        eventIds
      ]),
      appBClient.query("delete from processed_events where event_id = any($1::uuid[])", [
        eventIds
      ])
    ]);
  }

  await Promise.all([
    appAClient.query("delete from local_sessions where external_user_id = $1", [userId]),
    appAClient.query("delete from profile_cache where external_user_id = $1", [userId]),
    appBClient.query("delete from local_sessions where external_user_id = $1", [userId]),
    appBClient.query("delete from profile_cache where external_user_id = $1", [userId])
  ]);
  await client.query("delete from users where id = $1", [userId]);
  tempUserIds.delete(userId);
}

async function cleanupApplication(applicationId) {
  await client.query("delete from applications where id = $1", [applicationId]);
  tempApplicationIds.delete(applicationId);
}

function rabbitAuthHeaders() {
  return {
    authorization: `Basic ${Buffer.from("guest:guest").toString("base64")}`
  };
}

async function getQueues() {
  const response = await fetch(`${RABBITMQ}/api/queues/%2F`, {
    headers: rabbitAuthHeaders()
  });
  const text = await response.text();

  assert.equal(response.status, 200, text);

  return JSON.parse(text);
}

async function purgeQueue(name) {
  const response = await fetch(`${RABBITMQ}/api/queues/%2F/${encodeURIComponent(name)}/contents`, {
    method: "DELETE",
    headers: {
      ...rabbitAuthHeaders(),
      "content-type": "application/json"
    },
    body: JSON.stringify({ mode: "purge" })
  });

  assert.ok(response.status === 204 || response.status === 200, `Purge ${name} failed`);
}

async function expectNoSensitiveAppStorage(dbClient, label) {
  const sensitiveColumns = await dbClient.query(
    `select table_name, column_name
     from information_schema.columns
     where table_schema = 'public'
       and table_name in ('local_sessions', 'profile_cache', 'activity_logs', 'processed_events')
       and (
         column_name ilike '%password%'
         or column_name ilike '%secret%'
         or column_name in ('authorization_code', 'code', 'access_token', 'token', 'session_token')
       )
     order by table_name, column_name`
  );
  const forbiddenTables = await dbClient.query(
    `select to_regclass('public.authorization_codes') as authorization_codes,
            to_regclass('public.access_tokens') as access_tokens,
            to_regclass('public.users') as users`
  );

  assert.deepEqual(sensitiveColumns.rows, [], `${label} should not store sensitive columns`);
  assert.equal(forbiddenTables.rows[0].authorization_codes, null);
  assert.equal(forbiddenTables.rows[0].access_tokens, null);
  assert.equal(forbiddenTables.rows[0].users, null);
}

async function expectAppLoginPage(appBase, displayName) {
  const response = await fetch(`${appBase}/`);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, new RegExp(displayName));
  assert.match(text, /Local session belum aktif/);
  assert.match(text, /Login with Auth Provider/);
  assert.doesNotMatch(text, /type=["']password["']/i);
  assert.doesNotMatch(text, /<form/i);
}

async function expectAppLoginStart(appBase, clientId) {
  const jar = new CookieJar();
  const response = await jar.fetch(`${appBase}/login`);

  assert.ok(response.status >= 300 && response.status < 400);

  const location = new URL(redirectLocation(response));
  const expectedCallback = `${appBase}/callback`;
  const stateCookie = jar.cookies.get(`${clientId.replaceAll("-", "_")}_oauth_state`);
  const verifierCookie = jar.cookies.get(`${clientId.replaceAll("-", "_")}_pkce_verifier`);

  assert.equal(location.origin + location.pathname, `${AUTH}/authorize`);
  assert.equal(location.searchParams.get("client_id"), clientId);
  assert.equal(location.searchParams.get("redirect_uri"), expectedCallback);
  assert.equal(location.searchParams.get("state"), stateCookie);
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.ok(stateCookie, `${clientId} should store OAuth state temporarily`);
  assert.ok(verifierCookie, `${clientId} should store PKCE code_verifier temporarily`);
  assert.equal(location.searchParams.get("code_challenge"), codeChallenge(verifierCookie));
}

async function expectAppHomeDetails(jar, appBase, user, expectedGroups) {
  const response = await jar.fetch(`${appBase}/`);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, new RegExp(`Hello, ${user.name}`));
  assert.match(text, new RegExp(user.email));
  for (const groupName of expectedGroups) {
    assert.match(text, new RegExp(groupName));
  }
  assert.match(text, /Local session/);
  assert.match(text, /Created/);
  assert.match(text, /Expires/);
  assert.match(text, /Central session/);
  assert.match(text, /Activity Log/);
  assert.match(text, /Processed Events/);

  return text;
}

async function expectLocalSessionStorage(dbClient, cookieValue, userId, label) {
  const session = await dbClient.query(
    `select id, session_token_hash, external_user_id, central_session_id, status, created_at,
            expires_at, revoked_at
     from local_sessions
     where external_user_id = $1
     order by created_at desc
     limit 1`,
    [userId]
  );

  assert.equal(session.rowCount, 1, `${label} local session should be stored`);
  assert.notEqual(session.rows[0].session_token_hash, cookieValue);
  assert.equal(session.rows[0].session_token_hash, hashToken(cookieValue));
  assert.equal(session.rows[0].external_user_id, userId);
  assert.equal(session.rows[0].status, "active");
  assert.equal(session.rows[0].revoked_at, null);
  assert.ok(session.rows[0].expires_at > new Date());

  return session.rows[0];
}

function expectMinimumEventPayload(event, expected) {
  const payload = event.payload ?? {};
  const payloadValues = [];

  function collectValues(value) {
    if (Array.isArray(value)) {
      for (const item of value) collectValues(item);
      return;
    }

    if (value && typeof value === "object") {
      for (const item of Object.values(value)) collectValues(item);
      return;
    }

    payloadValues.push(value);
  }

  collectValues(payload);

  assert.equal(event.event_type, expected.eventType);
  assert.equal(event.user_id, expected.userId);
  assert.equal(payload.eventId, event.id);
  assert.equal(payload.eventType, expected.eventType);
  assert.equal(payload.userId, expected.userId);
  assert.equal(payload.reason, expected.reason);
  assert.ok(Date.parse(payload.occurredAt));
  assert.ok(event.created_at instanceof Date);
  for (const sensitiveValue of [CLIENT_SECRET, INTERNAL_LOGOUT_TOKEN, PASSWORD]) {
    assert.notEqual(sensitiveValue, "");
    assert.equal(payloadValues.includes(sensitiveValue), false);
  }

  if (expected.centralSessionId !== undefined) {
    assert.equal(event.central_session_id, expected.centralSessionId);
    assert.equal(payload.centralSessionId, expected.centralSessionId);
  }

  if (expected.applicationId !== undefined) {
    assert.equal(event.application_id, expected.applicationId);
    assert.equal(payload.applicationId, expected.applicationId);
  }
}

async function expectProcessedEvent(dbClient, applicationId, eventId, eventType) {
  await waitFor(async () => {
    const processed = await dbClient.query(
      `select event_type, result
       from processed_events
       where application_id = $1 and event_id = $2`,
      [applicationId, eventId]
    );

    assert.equal(processed.rowCount, 1);
    assert.equal(processed.rows[0].event_type, eventType);
    assert.equal(processed.rows[0].result, "succeeded");
  }, `${applicationId} processed ${eventType}`);
}

function dockerCompose(args) {
  execFileSync("docker", ["compose", ...args], {
    cwd: process.cwd(),
    stdio: "pipe"
  });
}

async function dockerComposeAsync(args) {
  await execFileAsync("docker", ["compose", ...args], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024
  });
}

async function waitWorkerHealthy() {
  await waitFor(async () => {
    const response = await fetch("http://localhost:3003/health");
    const body = await expectJsonStatus(response, 200);

    assert.equal(body.status, "ok");
    assert.equal(body.worker.rabbitmqConnected, true);
  }, "sync worker healthy", 30000);
}

function metricSum(text, metricName) {
  const values = [];
  const pattern = new RegExp(`^${metricName}(?:\\{[^}]*\\})?\\s+([0-9.]+)$`, "gm");
  let match;

  while ((match = pattern.exec(text))) {
    values.push(Number(match[1]));
  }

  return values.reduce((sum, value) => sum + value, 0);
}

function startLogoutProbe(failuresBeforeSuccess = 0, responseDelayMs = 0) {
  const requests = [];
  let requestCount = 0;
  const server = createServer((request, response) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requestCount += 1;
      requests.push({
        headers: request.headers,
        body: body ? JSON.parse(body) : null
      });

      const sendResponse = () => {
        if (requestCount <= failuresBeforeSuccess) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "temporary failure" }));
          return;
        }

        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
      };

      if (responseDelayMs > 0) {
        setTimeout(sendResponse, responseDelayMs);
      } else {
        sendResponse();
      }
    });
  });

  return {
    requests,
    async listen() {
      await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
      const address = server.address();

      assert.ok(address && typeof address === "object");

      return `http://host.docker.internal:${address.port}/internal/logout`;
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

before(async () => {
  for (const url of [`${AUTH}/health`, `${APP_A}/health`, `${APP_B}/health`, `${ADMIN}/health`]) {
    const response = await fetch(url);
    assert.equal(response.status, 200, `${url} should be healthy`);
  }

  const workerHealth = await jsonRequest("http://localhost:3003/health");

  assert.equal(workerHealth.status, "ok");
  assert.equal(workerHealth.worker.rabbitmqConnected, true);

  client = new Client({ connectionString: DB_URL });
  appAClient = new Client({ connectionString: APP_A_DB_URL });
  appBClient = new Client({ connectionString: APP_B_DB_URL });
  await client.connect();
  await appAClient.connect();
  await appBClient.connect();

  const groups = await jsonRequest(`${ADMIN}/admin/groups`);
  appAGroup = groups.find((group) => group.name === "app-a-users");
  appBGroup = groups.find((group) => group.name === "app-b-users");

  assert.ok(appAGroup, "Seed group app-a-users should exist");
  assert.ok(appBGroup, "Seed group app-b-users should exist");

  const apps = await jsonRequest(`${ADMIN}/admin/applications`);
  appA = apps.find((application) => application.clientId === "app-a");
  appB = apps.find((application) => application.clientId === "app-b");

  assert.ok(appA, "Seed application app-a should exist");
  assert.ok(appB, "Seed application app-b should exist");

  await purgeQueue("revocation.deliveries");
  await purgeQueue("revocation.deliveries.dlq");
});

after(async () => {
  for (const userId of [...tempUserIds]) {
    await cleanupUser(userId);
  }

  for (const applicationId of [...tempApplicationIds]) {
    await cleanupApplication(applicationId);
  }

  if (client) {
    await client.end();
  }

  if (appAClient) {
    await appAClient.end();
  }

  if (appBClient) {
    await appBClient.end();
  }
});

test("login accepts valid credentials and rejects invalid credentials", async () => {
  const jar = new CookieJar();

  const success = await loginAuth(jar, "both-apps-user@example.com");

  assert.equal(success.user.email, "both-apps-user@example.com");

  const failed = await new CookieJar().fetch(`${AUTH}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form({
      email: "both-apps-user@example.com",
      password: "wrong-password"
    })
  });

  await expectJsonStatus(failed, 401);
});

test("unknown routes use standard error format", async () => {
  for (const url of [
    `${AUTH}/missing`,
    `${APP_A}/missing`,
    `${APP_B}/missing`,
    "http://localhost:3003/missing",
    {
      url: `${ADMIN}/missing`,
      headers: {
        authorization: ADMIN_AUTH
      }
    }
  ]) {
    const response = typeof url === "string" ? await fetch(url) : await fetch(url.url, url);
    const body = await expectJsonStatus(response, 404);

    assert.equal(body.error.code, "NOT_FOUND");
    assert.equal(typeof body.error.message, "string");
    assert.equal(typeof body.error.requestId, "string");
  }
});

test("error responses stay generic and internal logout requires its token", async () => {
  const loginResponses = await Promise.all([
    fetch(`${AUTH}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form({
        email: "both-apps-user@example.com",
        password: "wrong-password"
      })
    }),
    fetch(`${AUTH}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form({
        email: "unknown-user@example.com",
        password: "wrong-password"
      })
    })
  ]);
  const loginBodies = [];

  for (const response of loginResponses) {
    const body = await expectJsonStatus(response, 401);

    assert.equal(body.error.code, "INVALID_CREDENTIALS");
    assert.equal(typeof body.error.message, "string");
    assert.equal(typeof body.error.requestId, "string");
    loginBodies.push(body);
  }

  assert.equal(loginBodies[0].error.message, loginBodies[1].error.message);

  for (const body of loginBodies) {
    const bodyText = JSON.stringify(body);

    for (const sensitiveValue of [PASSWORD, CLIENT_SECRET, INTERNAL_LOGOUT_TOKEN]) {
      assert.equal(bodyText.includes(sensitiveValue), false);
    }

    assert.doesNotMatch(bodyText, /passwordHash|sessionToken|accessToken|stack trace/i);
  }

  for (const appBase of [APP_A, APP_B]) {
    for (const headers of [{}, { "x-internal-token": "wrong-token" }]) {
      const response = await fetch(`${appBase}/internal/logout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers
        },
        body: JSON.stringify({
          eventId: randomUUID(),
          userId: randomUUID()
        })
      });
      const body = await expectJsonStatus(response, 401);

      assert.equal(body.error.code, "UNAUTHORIZED");
      assert.equal(typeof body.error.requestId, "string");
      assert.doesNotMatch(JSON.stringify(body), /passwordHash|sessionToken|accessToken|stack trace/i);
    }
  }
});

test("admin routes require credentials", async () => {
  const response = await fetch(`${ADMIN}/admin/users`);
  const body = await expectJsonStatus(response, 401);

  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.match(response.headers.get("www-authenticate") ?? "", /Basic/);
});

test("revocation-related controls are present in the web UIs", async () => {
  const [controlPanelResponse, authResponse] = await Promise.all([
    fetch(`${ADMIN}/`, {
      headers: {
        authorization: ADMIN_AUTH
      }
    }),
    fetch(`${AUTH}/`)
  ]);
  const controlPanelHtml = await controlPanelResponse.text();
  const authHtml = await authResponse.text();

  assert.equal(controlPanelResponse.status, 200);
  assert.match(controlPanelHtml, /Control Panel Admin/);
  assert.match(controlPanelHtml, /Users/);
  assert.match(controlPanelHtml, /Applications/);
  assert.match(controlPanelHtml, /Audit Logs/);
  assert.match(controlPanelHtml, /user-password-/);
  assert.match(controlPanelHtml, /\/admin\/users\/" \+ id \+ "\/password/);
  assert.match(controlPanelHtml, /addPolicy/);
  assert.match(controlPanelHtml, /removePolicy/);

  assert.equal(authResponse.status, 200);
  assert.match(authHtml, /Login|Central session/);
});

test("metrics expose request errors, latency, delivery state, and live backlog", { timeout: 90000 }, async () => {
  const initialResponse = await fetch(`${AUTH}/metrics`);
  const initialMetrics = await initialResponse.text();

  assert.equal(initialResponse.status, 200);
  assert.match(initialResponse.headers.get("content-type") ?? "", /text\/plain/);
  for (const metricName of [
    "identity_http_requests_total",
    "identity_http_errors_total",
    "identity_http_request_duration_ms_sum",
    "identity_http_request_duration_ms_max",
    "identity_event_delivery_backlog",
    "identity_event_deliveries_pending",
    "identity_event_deliveries_processing",
    "identity_event_deliveries_retrying",
    "identity_event_deliveries_failed",
    "identity_event_deliveries_succeeded"
  ]) {
    assert.match(initialMetrics, new RegExp(`^${metricName}(?:\\{|$)`, "m"));
  }

  const dashboardResponse = await fetch(`${AUTH}/metrics/dashboard`);
  const dashboard = await dashboardResponse.text();

  assert.equal(dashboardResponse.status, 200);
  assert.match(dashboardResponse.headers.get("content-type") ?? "", /text\/html/);
  assert.match(dashboard, /Avg Latency/);
  assert.match(dashboard, /Errors/);
  assert.match(dashboard, /identity_event_delivery_backlog/);

  const initialRequestCount = metricSum(initialMetrics, "identity_http_requests_total");
  const initialErrorCount = metricSum(initialMetrics, "identity_http_errors_total");
  const missingRoute = await fetch(`${AUTH}/metrics-test-missing`);

  assert.equal(missingRoute.status, 404);

  const afterErrorMetrics = await (await fetch(`${AUTH}/metrics`)).text();
  assert.ok(metricSum(afterErrorMetrics, "identity_http_requests_total") > initialRequestCount);
  assert.ok(metricSum(afterErrorMetrics, "identity_http_errors_total") > initialErrorCount);

  const activityJar = new CookieJar();
  await loginAuth(activityJar, "app-a-user@example.com");
  const logoutResponse = await activityJar.fetch(`${AUTH}/logout-sso`, {
    method: "POST"
  });

  assert.equal(logoutResponse.status, 200);
  const afterLoginLogoutMetrics = await (await fetch(`${AUTH}/metrics`)).text();
  assert.ok(
    metricSum(afterLoginLogoutMetrics, "identity_http_requests_total") >
      metricSum(afterErrorMetrics, "identity_http_requests_total")
  );

  const user = await createTempUser([], "metrics-worker");
  const eventId = randomUUID();
  const deliveryIds = [randomUUID(), randomUUID()];

  try {
    await waitFor(async () => {
      const metrics = await (await fetch(`${AUTH}/metrics`)).text();

      assert.equal(metricSum(metrics, "identity_event_delivery_backlog"), 0);
    }, "metrics backlog baseline drained", 15000);

    const beforeWorkerStop = await (await fetch(`${AUTH}/metrics`)).text();
    const beforeBacklog = metricSum(beforeWorkerStop, "identity_event_delivery_backlog");
    const beforePending = metricSum(beforeWorkerStop, "identity_event_deliveries_pending");

    dockerCompose(["stop", "sync-worker"]);

    try {
      await client.query(
        `insert into events (id, event_type, user_id, payload, status, created_at)
         values ($1, 'SessionRevoked', $2, $3::jsonb, 'pending', now())`,
        [
          eventId,
          user.id,
          JSON.stringify({
            eventId,
            eventType: "SessionRevoked",
            userId: user.id,
            reason: "metrics_test",
            occurredAt: new Date().toISOString(),
            metadata: {}
          })
        ]
      );
      await client.query(
        `insert into event_deliveries (id, event_id, application_id, status)
         values ($1, $3, $2, 'pending'), ($4, $3, $5, 'pending')`,
        [deliveryIds[0], appA.id, eventId, deliveryIds[1], appB.id]
      );

      const whileStopped = await (await fetch(`${AUTH}/metrics`)).text();
      const whileStoppedBacklog = metricSum(whileStopped, "identity_event_delivery_backlog");
      const whileStoppedPending = metricSum(whileStopped, "identity_event_deliveries_pending");

      assert.ok(
        whileStoppedBacklog >= beforeBacklog + 2,
        `Expected backlog ${beforeBacklog + 2}, got ${whileStoppedBacklog}`
      );
      assert.ok(
        whileStoppedPending >= beforePending + 2,
        `Expected pending ${beforePending + 2}, got ${whileStoppedPending}`
      );
    } finally {
      dockerCompose(["start", "sync-worker"]);
      await waitWorkerHealthy();
    }

    await waitFor(async () => {
      const deliveries = await client.query(
        "select status from event_deliveries where id = any($1::uuid[])",
        [deliveryIds]
      );

      assert.equal(deliveries.rowCount, 2);
      assert.ok(deliveries.rows.every((delivery) => delivery.status === "succeeded"));
    }, "metrics test deliveries succeeded");

    const afterWorkerRestart = await (await fetch(`${AUTH}/metrics`)).text();
    assert.ok(
      metricSum(afterWorkerRestart, "identity_event_delivery_backlog") <= beforeBacklog,
      "Backlog should return to or below its pre-stop level"
    );
  } finally {
    try {
      dockerCompose(["start", "sync-worker"]);
      await waitWorkerHealthy();
    } catch {
      // Keep the test failure visible while attempting to restore the worker.
    }
    await cleanupUser(user.id);
  }
});

test("admin can filter audit logs by section, type, and time", async () => {
  const from = new Date(Date.now() - 60_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await postJson(`${ADMIN}/admin/users`, {
    name: "Audit Filter User",
    email: `audit-filter-${suffix}@example.com`,
    password: PASSWORD,
    status: "ACTIVE"
  });
  const group = await postJson(`${ADMIN}/admin/groups`, {
    name: `audit-filter-${suffix}`,
    description: "Audit filter test"
  });
  const application = await postJson(`${ADMIN}/admin/applications`, {
    name: "Audit Filter App",
    clientId: `audit-filter-${suffix}`,
    clientSecret: CLIENT_SECRET,
    status: "ACTIVE",
    launchUrl: "http://localhost:3001",
    logoutNotificationUrl: "http://app-a:3001/internal/logout"
  });

  tempUserIds.add(user.id);
  tempApplicationIds.add(application.id);

  try {
    const userLogs = await jsonRequest(
      `${ADMIN}/admin/audit-logs?section=users&eventType=AdminUserCreated&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`
    );
    assert.ok(
      userLogs.some((log) => log.eventType === "AdminUserCreated" && log.userId === user.id)
    );
    assert.ok(userLogs.every((log) => log.eventType === "AdminUserCreated"));

    const groupLogs = await jsonRequest(
      `${ADMIN}/admin/audit-logs?section=groups&eventType=AdminGroupCreated&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`
    );
    assert.ok(groupLogs.some((log) => log.eventType === "AdminGroupCreated"));
    assert.ok(groupLogs.every((log) => log.eventType === "AdminGroupCreated"));

    const applicationLogs = await jsonRequest(
      `${ADMIN}/admin/audit-logs?section=applications&eventType=AdminApplicationCreated&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`
    );
    assert.ok(
      applicationLogs.some(
        (log) => log.eventType === "AdminApplicationCreated" && log.applicationId === application.id
      )
    );
    assert.ok(applicationLogs.every((log) => log.eventType === "AdminApplicationCreated"));

    const invalidRange = await fetch(
      `${ADMIN}/admin/audit-logs?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`,
      {
        headers: {
          authorization: ADMIN_AUTH
        }
      }
    );
    const invalidBody = await expectJsonStatus(invalidRange, 400);
    assert.equal(invalidBody.error.code, "INVALID_QUERY");
  } finally {
    await cleanupUser(user.id);
    await cleanupApplication(application.id);
    await deleteJson(`${ADMIN}/admin/groups/${group.id}`);
  }
});

test("admin can update user name and email", async () => {
  const user = await createTempUser([appAGroup], "profile-update");
  const updatedEmail = `updated-${user.email}`;
  const updated = await patchJson(`${ADMIN}/admin/users/${user.id}`, {
    name: "Updated Profile User",
    email: updatedEmail,
    status: "ACTIVE"
  });

  assert.equal(updated.name, "Updated Profile User");
  assert.equal(updated.email, updatedEmail);

  const jar = new CookieJar();
  const login = await loginAuth(jar, updatedEmail);

  assert.equal(login.user.email, updatedEmail);
});

test("MFA enrollment requires TOTP before issuing central session on later logins", async () => {
  const user = await createTempUser([appAGroup], "mfa");

  try {
    const enrollmentJar = new CookieJar();

    await loginAuth(enrollmentJar, user.email);

    const enrollPage = await enrollmentJar.fetch(`${AUTH}/mfa/enroll`);
    const html = await enrollPage.text();
    const secret = html.match(/<code id="totp-secret">([^<]+)<\/code>/)?.[1];

    assert.equal(enrollPage.status, 200);
    assert.ok(secret, "Enrollment page should expose manual TOTP secret for authenticator setup");

    const refreshedEnrollPage = await enrollmentJar.fetch(`${AUTH}/mfa/enroll`);
    const refreshedSecret = (await refreshedEnrollPage.text()).match(
      /<code id="totp-secret">([^<]+)<\/code>/
    )?.[1];

    assert.equal(refreshedEnrollPage.status, 200);
    assert.equal(refreshedSecret, secret);
    assert.match(html, /MFA Enrollment/);
    assert.match(html, /Authenticator URI/);
    assert.match(html, /otpauth:\/\/totp\//);

    const storedCredential = await client.query(
      "select secret_encrypted, enabled_at from mfa_totp_credentials where user_id = $1",
      [user.id]
    );

    assert.equal(storedCredential.rowCount, 1);
    assert.match(storedCredential.rows[0].secret_encrypted, /^v1:/);
    assert.notEqual(storedCredential.rows[0].secret_encrypted, secret);
    assert.equal(storedCredential.rows[0].secret_encrypted.includes(secret), false);
    assert.equal(storedCredential.rows[0].enabled_at, null);

    const validEnrollmentCode = generateTotpCode(secret);
    const invalidEnrollmentCode =
      validEnrollmentCode === "000000" ? "000001" : "000000";
    const wrongEnroll = await enrollmentJar.fetch(`${AUTH}/mfa/enroll`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ code: invalidEnrollmentCode })
    });

    assert.equal(wrongEnroll.status, 401);

    const enroll = await postJson(`${AUTH}/mfa/enroll`, {
      code: validEnrollmentCode
    }, {
      cookie: enrollmentJar.header()
    });

    assert.deepEqual(enroll, {
      status: "ok",
      method: "totp"
    });

    await enrollmentJar.fetch(`${AUTH}/logout-sso`, {
      method: "POST"
    });

    const passwordOnlyJar = new CookieJar();
    const passwordOnly = await loginAuth(passwordOnlyJar, user.email);

    assert.equal(passwordOnly.mfaRequired, true);
    const challengeCookie = passwordOnlyJar.cookies.get("mfa_challenge");
    const pendingChallenge = await client.query(
      `select challenge_token_hash, status, created_at, expires_at
       from mfa_challenges
       where user_id = $1 and status = 'pending'
       order by created_at desc
       limit 1`,
      [user.id]
    );

    assert.ok(challengeCookie);
    assert.equal(pendingChallenge.rowCount, 1);
    assert.notEqual(pendingChallenge.rows[0].challenge_token_hash, challengeCookie);
    assert.ok(pendingChallenge.rows[0].expires_at > new Date());
    assert.ok(
      pendingChallenge.rows[0].expires_at.getTime() -
        pendingChallenge.rows[0].created_at.getTime() <=
        5 * 60 * 1000
    );
    await expectCentralRevoked(
      passwordOnlyJar,
      "password-only login for MFA user must not create central session"
    );

    const validLoginCode = generateTotpCode(secret);
    const invalidLoginCode = validLoginCode === "000000" ? "000001" : "000000";
    const wrongMfa = await passwordOnlyJar.fetch(`${AUTH}/login/mfa`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ code: invalidLoginCode })
    });

    assert.equal(wrongMfa.status, 401);
    await expectCentralRevoked(passwordOnlyJar, "wrong MFA code must not create central session");

    await loginMfa(passwordOnlyJar, validLoginCode);
    await expectCentralActive(passwordOnlyJar, "valid MFA code should create central session");

    const appJar = new CookieJar();

    await loginApp(appJar, APP_A, user.email, PASSWORD, secret);
    await expectAppActive(appJar, APP_A, "MFA user should complete App A OAuth login");

    const audits = await client.query(
      "select event_type, result from audit_logs where user_id = $1 and event_type in ('mfa_enrolled', 'mfa_success', 'mfa_failed')",
      [user.id]
    );
    const auditKeys = new Set(audits.rows.map((row) => `${row.event_type}:${row.result}`));

    assert.ok(auditKeys.has("mfa_enrolled:success"));
    assert.ok(auditKeys.has("mfa_success:success"));
    assert.ok(auditKeys.has("mfa_failed:failed"));
  } finally {
    await cleanupUser(user.id);
  }
});

test("authorize allows matching policy and denies missing policy", async () => {
  const allowedJar = new CookieJar();
  const verifier = "allow-verifier";

  await loginAuth(allowedJar, "both-apps-user@example.com");

  const allowed = await authorize(allowedJar, {
    clientId: "app-a",
    redirectUri: "http://localhost:3001/callback",
    codeChallenge: codeChallenge(verifier)
  });

  assert.equal(allowed.origin + allowed.pathname, "http://localhost:3001/callback");
  const authorizationCode = allowed.searchParams.get("code");
  assert.ok(authorizationCode);

  const authorizationCodeRecord = await client.query(
    `select code_hash, redirect_uri, created_at, expires_at
     from authorization_codes
     where code_hash = $1`,
    [hashToken(authorizationCode)]
  );

  assert.equal(authorizationCodeRecord.rowCount, 1);
  assert.equal(authorizationCodeRecord.rows[0].redirect_uri, "http://localhost:3001/callback");
  assert.notEqual(authorizationCodeRecord.rows[0].code_hash, authorizationCode);
  assert.ok(
    authorizationCodeRecord.rows[0].expires_at.getTime() -
      authorizationCodeRecord.rows[0].created_at.getTime() <=
      5 * 60 * 1000
  );

  const deniedUser = await createTempUser([appBGroup], "authorize-deny");

  try {
    const deniedJar = new CookieJar();

    await loginAuth(deniedJar, deniedUser.email);

    const denied = await authorize(deniedJar, {
      clientId: "app-a",
      redirectUri: "http://localhost:3001/callback",
      codeChallenge: codeChallenge("deny-verifier")
    });

    assert.equal(denied.searchParams.get("error"), "access_denied");
    assert.equal(denied.searchParams.has("error_description"), false);
    assert.doesNotMatch(denied.toString(), /password|secret|policyId|groupId|userGroups/i);

    const policyDeniedAudits = await client.query(
      "select count(*)::int as count from audit_logs where user_id = $1 and application_id = $2 and event_type = 'PolicyDenied' and result = 'failed'",
      [deniedUser.id, appA.id]
    );
    const policyDeniedEvents = await client.query(
      "select status, payload from events where user_id = $1 and application_id = $2 and event_type = 'PolicyDenied' order by created_at desc limit 1",
      [deniedUser.id, appA.id]
    );

    assert.ok(policyDeniedAudits.rows[0].count >= 1);
    assert.equal(policyDeniedEvents.rowCount, 1);
    assert.equal(policyDeniedEvents.rows[0].status, "processed");
    assert.equal(policyDeniedEvents.rows[0].payload.reason, "policy_denied");
  } finally {
    await cleanupUser(deniedUser.id);
  }
});

test("token endpoint rejects wrong redirect, used code, expired code, and validates userinfo audience", async () => {
  const jar = new CookieJar();
  const verifier = "token-verifier";

  await loginAuth(jar, "both-apps-user@example.com");

  const code = await getAuthorizationCode(
    jar,
    "app-a",
    "http://localhost:3001/callback",
    verifier
  );

  const wrongRedirect = await tokenRequest({
    client_id: "app-a",
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri: "http://localhost:3001/wrong-callback",
    code_verifier: verifier
  });

  assert.equal(wrongRedirect.response.status, 400, wrongRedirect.text);

  const success = await tokenRequest({
    client_id: "app-a",
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri: "http://localhost:3001/callback",
    code_verifier: verifier
  });

  assert.equal(success.response.status, 200, success.text);
  assert.ok(success.data.access_token);

  const used = await tokenRequest({
    client_id: "app-a",
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri: "http://localhost:3001/callback",
    code_verifier: verifier
  });

  assert.equal(used.response.status, 400, used.text);

  const userinfoOk = await fetch(`${AUTH}/userinfo?client_id=app-a`, {
    headers: {
      authorization: `Bearer ${success.data.access_token}`
    }
  });

  assert.equal(userinfoOk.status, 200, await userinfoOk.text());

  const userinfoWrongAudience = await fetch(`${AUTH}/userinfo?client_id=app-b`, {
    headers: {
      authorization: `Bearer ${success.data.access_token}`
    }
  });

  assert.equal(userinfoWrongAudience.status, 401);

  const expiredVerifier = "expired-verifier";
  const expiredCode = await getAuthorizationCode(
    jar,
    "app-a",
    "http://localhost:3001/callback",
    expiredVerifier
  );

  await client.query(
    "update authorization_codes set expires_at = now() - interval '1 minute' where code_hash = $1",
    [hashToken(expiredCode)]
  );

  const expired = await tokenRequest({
    client_id: "app-a",
    client_secret: CLIENT_SECRET,
    code: expiredCode,
    redirect_uri: "http://localhost:3001/callback",
    code_verifier: expiredVerifier
  });

  assert.equal(expired.response.status, 400, expired.text);
});

test("token and userinfo enforce client secret, PKCE, storage, and active subjects", async () => {
  const user = await createTempUser([appAGroup], "token-userinfo");
  const jar = new CookieJar();

  async function issueToken(verifier) {
    const code = await getAuthorizationCode(
      jar,
      "app-a",
      "http://localhost:3001/callback",
      verifier
    );
    const result = await tokenRequest({
      client_id: "app-a",
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: "http://localhost:3001/callback",
      code_verifier: verifier
    });

    assert.equal(result.response.status, 200, result.text);
    assert.equal(result.data.token_type, "Bearer");
    assert.ok(result.data.access_token);

    return result.data.access_token;
  }

  try {
    await loginAuth(jar, user.email);

    const verifier = "token-userinfo-verifier";
    const code = await getAuthorizationCode(
      jar,
      "app-a",
      "http://localhost:3001/callback",
      verifier
    );

    const wrongSecret = await tokenRequest({
      client_id: "app-a",
      client_secret: "wrong-secret",
      code,
      redirect_uri: "http://localhost:3001/callback",
      code_verifier: verifier
    });
    assert.equal(wrongSecret.response.status, 401, wrongSecret.text);

    const wrongPkce = await tokenRequest({
      client_id: "app-a",
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: "http://localhost:3001/callback",
      code_verifier: "wrong-verifier"
    });
    assert.equal(wrongPkce.response.status, 400, wrongPkce.text);

    const [firstExchange, secondExchange] = await Promise.all([
      tokenRequest({
        client_id: "app-a",
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: "http://localhost:3001/callback",
        code_verifier: verifier
      }),
      tokenRequest({
        client_id: "app-a",
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: "http://localhost:3001/callback",
        code_verifier: verifier
      })
    ]);
    const exchangeStatuses = [firstExchange.response.status, secondExchange.response.status].sort();
    const successfulExchange = [firstExchange, secondExchange].find(
      (exchange) => exchange.response.status === 200
    );

    assert.deepEqual(exchangeStatuses, [200, 400]);
    assert.ok(successfulExchange);
    assert.equal(successfulExchange.data.token_type, "Bearer");
    assert.equal(successfulExchange.data.expires_in, 60 * 60);
    assert.ok(!successfulExchange.data.access_token.includes("."));

    const accessToken = successfulExchange.data.access_token;
    const authorizationCodeRecord = await client.query(
      "select used_at from authorization_codes where code_hash = $1",
      [hashToken(code)]
    );
    const tokenRecord = await client.query(
      `select token_hash, user_id, application_id, sso_session_id, scopes, status, expires_at
       from access_tokens
       where token_hash = $1`,
      [hashToken(accessToken)]
    );

    assert.equal(authorizationCodeRecord.rowCount, 1);
    assert.ok(authorizationCodeRecord.rows[0].used_at);
    assert.equal(tokenRecord.rowCount, 1);
    assert.notEqual(tokenRecord.rows[0].token_hash, accessToken);
    assert.equal(tokenRecord.rows[0].user_id, user.id);
    assert.equal(tokenRecord.rows[0].application_id, appA.id);
    assert.equal(tokenRecord.rows[0].scopes.clientId, "app-a");
    assert.equal(tokenRecord.rows[0].status, "active");
    assert.ok(tokenRecord.rows[0].sso_session_id);
    assert.ok(tokenRecord.rows[0].expires_at > new Date());

    const userinfoOk = await fetch(`${AUTH}/userinfo?client_id=app-a`, {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const profile = await expectJsonStatus(userinfoOk, 200);

    assert.equal(profile.id, user.id);
    assert.equal(profile.name, user.name);
    assert.equal(profile.email, user.email);
    assert.ok(profile.groups.some((group) => group.id === appAGroup.id));
    assert.equal(profile.centralSessionId, tokenRecord.rows[0].sso_session_id);
    assert.equal(profile.application.id, appA.id);
    assert.equal(profile.application.clientId, "app-a");

    const invalidBearer = await fetch(`${AUTH}/userinfo?client_id=app-a`, {
      headers: {
        authorization: "Bearer invalid-token"
      }
    });
    assert.equal(invalidBearer.status, 401);

    const wrongAudience = await fetch(`${AUTH}/userinfo?client_id=app-b`, {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    assert.equal(wrongAudience.status, 401);

    await client.query(
      "update access_tokens set status = 'revoked', revoked_at = now() where token_hash = $1",
      [hashToken(accessToken)]
    );
    const revokedToken = await fetch(`${AUTH}/userinfo?client_id=app-a`, {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    assert.equal(revokedToken.status, 401);

    const expiredToken = await issueToken("expired-token-verifier");
    await client.query("update access_tokens set expires_at = now() - interval '1 minute' where token_hash = $1", [
      hashToken(expiredToken)
    ]);
    const expiredUserinfo = await fetch(`${AUTH}/userinfo?client_id=app-a`, {
      headers: {
        authorization: `Bearer ${expiredToken}`
      }
    });
    assert.equal(expiredUserinfo.status, 401);

    const appInactiveToken = await issueToken("app-inactive-token-verifier");
    await client.query("update applications set status = 'inactive' where id = $1", [appA.id]);
    const inactiveApplicationUserinfo = await fetch(`${AUTH}/userinfo?client_id=app-a`, {
      headers: {
        authorization: `Bearer ${appInactiveToken}`
      }
    });
    assert.equal(inactiveApplicationUserinfo.status, 401);
    await client.query("update applications set status = 'active' where id = $1", [appA.id]);

    const userInactiveToken = await issueToken("user-inactive-token-verifier");
    await client.query("update users set status = 'inactive' where id = $1", [user.id]);
    const inactiveUserUserinfo = await fetch(`${AUTH}/userinfo?client_id=app-a`, {
      headers: {
        authorization: `Bearer ${userInactiveToken}`
      }
    });
    assert.equal(inactiveUserUserinfo.status, 401);
    await client.query("update users set status = 'active' where id = $1", [user.id]);

    const centralRevokedToken = await issueToken("central-revoked-token-verifier");
    const centralSession = await client.query(
      "select sso_session_id from access_tokens where token_hash = $1",
      [hashToken(centralRevokedToken)]
    );
    await client.query(
      "update sso_sessions set status = 'revoked', revoked_at = now(), revoke_reason = 'sso_logout' where id = $1",
      [centralSession.rows[0].sso_session_id]
    );
    const centralRevokedUserinfo = await fetch(`${AUTH}/userinfo?client_id=app-a`, {
      headers: {
        authorization: `Bearer ${centralRevokedToken}`
      }
    });
    assert.equal(centralRevokedUserinfo.status, 401);
  } finally {
    await client.query("update applications set status = 'active' where id = $1", [appA.id]);
    await client.query("update users set status = 'active' where id = $1", [user.id]);
    await cleanupUser(user.id);
  }
});

test("admin can edit redirect URIs and authorize uses exact current URI", async () => {
  const clientId = `redirect-edit-${Date.now()}`;
  const application = await postJson(`${ADMIN}/admin/applications`, {
    name: "Redirect Edit App",
    clientId,
    clientSecret: CLIENT_SECRET,
    status: "ACTIVE",
    launchUrl: "http://localhost:3001",
    logoutNotificationUrl: "http://app-a:3001/internal/logout"
  });
  tempApplicationIds.add(application.id);

  try {
    await postJson(`${ADMIN}/admin/applications/${application.id}/policies`, {
      groupId: appAGroup.id
    });

    const oldRedirectUri = "http://localhost:3001/old-callback";
    const newRedirectUri = "http://localhost:3001/new-callback";
    const redirectUri = await postJson(
      `${ADMIN}/admin/applications/${application.id}/redirect-uris`,
      { redirectUri: oldRedirectUri }
    );
    const updatedRedirectUri = await patchJson(
      `${ADMIN}/admin/applications/${application.id}/redirect-uris/${redirectUri.id}`,
      { redirectUri: newRedirectUri }
    );

    assert.equal(updatedRedirectUri.redirectUri, newRedirectUri);

    const jar = new CookieJar();
    await loginAuth(jar, "app-a-user@example.com");

    const oldUrl = new URL(`${AUTH}/authorize`);
    oldUrl.searchParams.set("client_id", clientId);
    oldUrl.searchParams.set("redirect_uri", oldRedirectUri);
    oldUrl.searchParams.set("state", "old-redirect");
    oldUrl.searchParams.set("code_challenge", codeChallenge("old-redirect-verifier"));
    oldUrl.searchParams.set("code_challenge_method", "S256");

    const oldResponse = await jar.fetch(oldUrl.toString());
    const oldBody = await expectJsonStatus(oldResponse, 400);
    assert.equal(oldBody.error.code, "INVALID_REDIRECT_URI");

    const allowed = await authorize(jar, {
      clientId,
      redirectUri: newRedirectUri,
      codeChallenge: codeChallenge("new-redirect-verifier")
    });

    assert.equal(allowed.origin + allowed.pathname, newRedirectUri);
    assert.ok(allowed.searchParams.get("code"));

    await deleteJson(
      `${ADMIN}/admin/applications/${application.id}/redirect-uris/${updatedRedirectUri.id}`
    );

    const deletedUrl = new URL(`${AUTH}/authorize`);
    deletedUrl.searchParams.set("client_id", clientId);
    deletedUrl.searchParams.set("redirect_uri", newRedirectUri);
    deletedUrl.searchParams.set("state", "deleted-redirect");
    deletedUrl.searchParams.set("code_challenge", codeChallenge("deleted-redirect-verifier"));
    deletedUrl.searchParams.set("code_challenge_method", "S256");

    const deletedResponse = await jar.fetch(deletedUrl.toString());
    const deletedBody = await expectJsonStatus(deletedResponse, 400);
    assert.equal(deletedBody.error.code, "INVALID_REDIRECT_URI");
  } finally {
    await cleanupApplication(application.id);
  }
});

test("App A and App B implement OAuth local sessions without storing IdP secrets", async () => {
  await expectAppLoginPage(APP_A, "App A");
  await expectAppLoginPage(APP_B, "App B");
  await expectAppLoginStart(APP_A, "app-a");
  await expectAppLoginStart(APP_B, "app-b");

  const badStateJar = new CookieJar();
  await badStateJar.fetch(`${APP_A}/login`);
  const badStateCallback = await badStateJar.fetch(`${APP_A}/callback?code=fake-code&state=wrong`);
  const badStateBody = await expectJsonStatus(badStateCallback, 400);

  assert.equal(badStateBody.error.code, "INVALID_STATE");

  const user = await createTempUser([appAGroup, appBGroup], "apps");

  try {
    const jar = new CookieJar();

    await loginApp(jar, APP_A, user.email);
    await expectAppHomeDetails(jar, APP_A, user, ["app-a-users", "app-b-users"]);
    await expectCentralActive(jar, "central session should exist after App A login");

    let response = await jar.fetch(`${APP_B}/login`);
    assert.ok(response.status >= 300 && response.status < 400);
    response = await jar.fetch(redirectLocation(response));
    assert.ok(response.status >= 300 && response.status < 400);

    const appBCallback = new URL(redirectLocation(response));
    assert.equal(appBCallback.origin + appBCallback.pathname, `${APP_B}/callback`);
    assert.ok(appBCallback.searchParams.get("code"));
    assert.doesNotMatch(appBCallback.toString(), /\/login/);

    response = await jar.fetch(appBCallback.toString());
    assert.ok(response.status >= 300 && response.status < 400);

    await expectAppHomeDetails(jar, APP_B, user, ["app-a-users", "app-b-users"]);

    const appASessionCookie = jar.cookies.get("app_a_session");
    const appBSessionCookie = jar.cookies.get("app_b_session");

    assert.ok(appASessionCookie, "App A should set its own local session cookie");
    assert.ok(appBSessionCookie, "App B should set its own local session cookie");
    assert.notEqual(appASessionCookie, appBSessionCookie);
    assert.equal(jar.cookies.has("app_a_oauth_state"), false);
    assert.equal(jar.cookies.has("app_a_pkce_verifier"), false);
    assert.equal(jar.cookies.has("app_b_oauth_state"), false);
    assert.equal(jar.cookies.has("app_b_pkce_verifier"), false);

    const [appADatabase, appBDatabase] = await Promise.all([
      appAClient.query("select current_database() as database_name"),
      appBClient.query("select current_database() as database_name")
    ]);

    assert.notEqual(
      appADatabase.rows[0].database_name,
      appBDatabase.rows[0].database_name,
      "App A and App B should use physically separate databases"
    );

    await Promise.all([
      expectNoSensitiveAppStorage(appAClient, "App A"),
      expectNoSensitiveAppStorage(appBClient, "App B")
    ]);

    const [appASession, appBSession] = await Promise.all([
      expectLocalSessionStorage(appAClient, appASessionCookie, user.id, "App A"),
      expectLocalSessionStorage(appBClient, appBSessionCookie, user.id, "App B")
    ]);

    assert.equal(appASession.central_session_id, appBSession.central_session_id);

    const [appAProfile, appBProfile] = await Promise.all([
      appAClient.query("select name, email, groups from profile_cache where external_user_id = $1", [
        user.id
      ]),
      appBClient.query("select name, email, groups from profile_cache where external_user_id = $1", [
        user.id
      ])
    ]);

    for (const profile of [appAProfile, appBProfile]) {
      assert.equal(profile.rowCount, 1);
      assert.equal(profile.rows[0].name, user.name);
      assert.equal(profile.rows[0].email, user.email);
      assert.ok(profile.rows[0].groups.some((group) => group.name === "app-a-users"));
      assert.ok(profile.rows[0].groups.some((group) => group.name === "app-b-users"));
    }

    const [appAActivities, appBActivities] = await Promise.all([
      appAClient.query(
        `select event_type
         from activity_logs
         where application_id = $1
         order by created_at desc
         limit 10`,
        ["app-a"]
      ),
      appBClient.query(
        `select event_type
         from activity_logs
         where application_id = $1
         order by created_at desc
         limit 10`,
        ["app-b"]
      )
    ]);

    for (const activities of [appAActivities, appBActivities]) {
      const eventTypes = new Set(activities.rows.map((row) => row.event_type));

      assert.ok(eventTypes.has("LoginStarted"));
      assert.ok(eventTypes.has("AuthorizationCodeReceived"));
      assert.ok(eventTypes.has("TokenExchanged"));
      assert.ok(eventTypes.has("UserinfoFetched"));
      assert.ok(eventTypes.has("LoginCompleted"));
    }

    const tamperedJar = new CookieJar();
    tamperedJar.cookies.set("app_a_session", "not-the-real-token");
    await expectAppLoggedOut(tamperedJar, APP_A, "App A should reject mismatched local cookie");

    await appAClient.query("update local_sessions set expires_at = now() - interval '1 minute' where id = $1", [
      appASession.id
    ]);
    await expectAppLoggedOut(jar, APP_A, "App A should reject expired local session");

    await loginApp(jar, APP_A, user.email);
    const refreshedAppASessionCookie = jar.cookies.get("app_a_session");
    const refreshedAppASession = await expectLocalSessionStorage(
      appAClient,
      refreshedAppASessionCookie,
      user.id,
      "App A refreshed"
    );
    await appAClient.query("update local_sessions set revoked_at = now() where id = $1", [
      refreshedAppASession.id
    ]);
    await expectAppLoggedOut(jar, APP_A, "App A should reject sessions with revoked_at set");

    await appBClient.query("update local_sessions set status = 'revoked' where id = $1", [
      appBSession.id
    ]);
    await expectAppLoggedOut(jar, APP_B, "App B should reject non-active local sessions");
  } finally {
    await cleanupUser(user.id);
  }
});

test("local logout keeps central session and other app session active", async () => {
  const jar = new CookieJar();

  await loginApp(jar, APP_A, "both-apps-user@example.com");
  await loginApp(jar, APP_B, "both-apps-user@example.com");

  const response = await jar.fetch(`${APP_A}/logout`, {
    method: "POST"
  });

  assert.ok(response.status >= 300 && response.status < 400);

  await expectAppLoggedOut(jar, APP_A, "App A should be logged out locally");
  await expectAppActive(jar, APP_B, "App B should remain active");
  await expectCentralActive(jar, "central session should remain active");

  await loginApp(jar, APP_A, "both-apps-user@example.com");

  const appBLogout = await jar.fetch(`${APP_B}/logout`, {
    method: "POST"
  });

  assert.ok(appBLogout.status >= 300 && appBLogout.status < 400);

  await expectAppLoggedOut(jar, APP_B, "App B should be logged out locally");
  await expectAppActive(jar, APP_A, "App A should remain active");
  await expectCentralActive(jar, "central session should remain active after App B local logout");
});

test("app refresh revokes local session when central session is already revoked", async () => {
  const user = await createTempUser([appAGroup], "central-refresh");
  const jar = new CookieJar();

  await loginApp(jar, APP_A, user.email);

  const localSession = await appAClient.query(
    "select id, central_session_id from local_sessions where external_user_id = $1 and status = 'active' order by created_at desc limit 1",
    [user.id]
  );

  assert.equal(localSession.rowCount, 1);

  await client.query(
    "update sso_sessions set status = 'revoked', revoked_at = now(), revoke_reason = 'sso_logout' where id = $1",
    [localSession.rows[0].central_session_id]
  );

  await expectAppLoggedOut(
    jar,
    APP_A,
    "App A should auto logout when central session is revoked"
  );

  const revokedSession = await appAClient.query(
    "select status, revoke_reason from local_sessions where id = $1",
    [localSession.rows[0].id]
  );

  assert.equal(revokedSession.rows[0].status, "revoked");
  assert.equal(revokedSession.rows[0].revoke_reason, "central_session_inactive");
});

test("SSO logout revokes central session, access tokens, and App A/App B local sessions", async () => {
  const user = await createTempUser([appAGroup, appBGroup], "sso-logout");
  const jar = new CookieJar();

  try {
    await loginApp(jar, APP_A, user.email);
    await loginApp(jar, APP_B, user.email);

    const home = await jar.fetch(`${AUTH}/`);
    assert.match(await home.text(), /Logout SSO/);

    const session = await expectCentralActive(jar, "central session before SSO logout");
    const beforeTokens = await client.query(
      "select count(*)::int as count from access_tokens where sso_session_id = $1 and status = 'active'",
      [session.session.id]
    );

    assert.ok(beforeTokens.rows[0].count >= 2);

    const start = Date.now();
    const response = await jar.fetch(`${AUTH}/logout-sso`, {
      method: "POST"
    });
    const elapsedMs = Date.now() - start;

    assert.equal(response.status, 200);
    assert.ok(elapsedMs < 2000, "SSO logout endpoint should not wait for app delivery completion");

    await expectCentralRevoked(jar, "central session should be revoked");

    const revokedTokens = await client.query(
      "select count(*)::int as count from access_tokens where sso_session_id = $1 and status = 'revoked'",
      [session.session.id]
    );
    const event = await client.query(
      `select id, event_type, user_id, central_session_id, application_id, payload, created_at
       from events
       where user_id = $1 and central_session_id = $2 and event_type = 'SessionRevoked'
       order by created_at desc
       limit 1`,
      [user.id, session.session.id]
    );

    assert.ok(revokedTokens.rows[0].count >= beforeTokens.rows[0].count);
    assert.equal(event.rowCount, 1);
    expectMinimumEventPayload(event.rows[0], {
      eventType: "SessionRevoked",
      userId: user.id,
      centralSessionId: session.session.id,
      reason: "sso_logout"
    });

    const deliveries = await client.query(
      `select application_id, status
       from event_deliveries
       where event_id = $1
       order by application_id`,
      [event.rows[0].id]
    );
    const deliveryApplicationIds = new Set(deliveries.rows.map((row) => row.application_id));

    assert.ok(deliveryApplicationIds.has(appA.id));
    assert.ok(deliveryApplicationIds.has(appB.id));

    await waitFor(() => expectAppLoggedOut(jar, APP_A, "App A should be revoked"), "App A SSO revocation");
    await waitFor(() => expectAppLoggedOut(jar, APP_B, "App B should be revoked"), "App B SSO revocation");
    await expectProcessedEvent(appAClient, "app-a", event.rows[0].id, "SessionRevoked");
    await expectProcessedEvent(appBClient, "app-b", event.rows[0].id, "SessionRevoked");

    const displayJar = new CookieJar();

    await loginApp(displayJar, APP_A, user.email);
    assert.match(await (await displayJar.fetch(`${APP_A}/`)).text(), /SessionRevoked/);
    await loginApp(displayJar, APP_B, user.email);
    assert.match(await (await displayJar.fetch(`${APP_B}/`)).text(), /SessionRevoked/);
  } finally {
    await cleanupUser(user.id);
  }
});

test("internal logout is idempotent through processed_events", async () => {
  const user = await createTempUser([appAGroup, appBGroup], "idempotent");

  try {
    const jar = new CookieJar();
    const eventId = randomUUID();

    await loginApp(jar, APP_A, user.email);
    await loginApp(jar, APP_B, user.email);

    const firstAppA = await postJson(`${APP_A}/internal/logout`, {
      eventId,
      eventType: "SessionRevoked",
      userId: user.id
    }, {
      "x-internal-token": INTERNAL_LOGOUT_TOKEN
    });

    assert.deepEqual(firstAppA, {
      status: "ok",
      revokedSessions: 1
    });

    const secondAppA = await postJson(`${APP_A}/internal/logout`, {
      eventId,
      eventType: "SessionRevoked",
      userId: user.id
    }, {
      "x-internal-token": INTERNAL_LOGOUT_TOKEN
    });

    assert.deepEqual(secondAppA, {
      status: "ok",
      duplicate: true
    });

    const firstAppB = await postJson(`${APP_B}/internal/logout`, {
      eventId,
      eventType: "SessionRevoked",
      userId: user.id
    }, {
      "x-internal-token": INTERNAL_LOGOUT_TOKEN
    });

    assert.deepEqual(firstAppB, {
      status: "ok",
      revokedSessions: 1
    });

    const secondAppB = await postJson(`${APP_B}/internal/logout`, {
      eventId,
      eventType: "SessionRevoked",
      userId: user.id
    }, {
      "x-internal-token": INTERNAL_LOGOUT_TOKEN
    });

    assert.deepEqual(secondAppB, {
      status: "ok",
      duplicate: true
    });

    await expectAppLoggedOut(jar, APP_A, "App A should be logged out by internal logout");
    await expectAppLoggedOut(jar, APP_B, "App B should be logged out by internal logout");

    await expectProcessedEvent(appAClient, "app-a", eventId, "SessionRevoked");
    await expectProcessedEvent(appBClient, "app-b", eventId, "SessionRevoked");
  } finally {
    await cleanupUser(user.id);
  }
});

test("admin inactive revokes central and local sessions and blocks future login", async () => {
  const user = await createTempUser([appAGroup, appBGroup], "inactive");

  try {
    const jar = new CookieJar();

    await loginApp(jar, APP_A, user.email);
    await loginApp(jar, APP_B, user.email);
    const centralSession = await expectCentralActive(jar, "central session before user inactive");
    const activeTokensBefore = await client.query(
      "select count(*)::int as count from access_tokens where user_id = $1 and status = 'active'",
      [user.id]
    );

    assert.ok(activeTokensBefore.rows[0].count >= 2);

    await patchJson(`${ADMIN}/admin/users/${user.id}`, {
      status: "INACTIVE"
    });

    await expectCentralRevoked(jar, "central session should be revoked after inactive");
    await waitFor(() => expectAppLoggedOut(jar, APP_A, "App A should be revoked"), "App A inactive revocation");
    await waitFor(() => expectAppLoggedOut(jar, APP_B, "App B should be revoked"), "App B inactive revocation");

    const activeTokens = await client.query(
      "select count(*)::int as count from access_tokens where user_id = $1 and status = 'active'",
      [user.id]
    );
    const event = await client.query(
      `select id, event_type, user_id, central_session_id, application_id, payload, created_at
       from events
       where user_id = $1 and central_session_id = $2 and event_type = 'SessionRevoked'
       order by created_at desc
       limit 1`,
      [user.id, centralSession.session.id]
    );

    assert.equal(activeTokens.rows[0].count, 0);
    assert.equal(event.rowCount, 1);
    expectMinimumEventPayload(event.rows[0], {
      eventType: "SessionRevoked",
      userId: user.id,
      centralSessionId: centralSession.session.id,
      reason: "user_inactive"
    });
    await expectProcessedEvent(appAClient, "app-a", event.rows[0].id, "SessionRevoked");
    await expectProcessedEvent(appBClient, "app-b", event.rows[0].id, "SessionRevoked");

    const response = await new CookieJar().fetch(`${AUTH}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form({
        email: user.email,
        password: PASSWORD
      })
    });

    assert.equal(response.status, 401);
  } finally {
    await cleanupUser(user.id);
  }
});

test("admin password change revokes all central sessions and local sessions", async () => {
  const user = await createTempUser([appAGroup, appBGroup], "password");
  const newPassword = "new-password-123";

  try {
    const jarOne = new CookieJar();
    const jarTwo = new CookieJar();

    await loginApp(jarOne, APP_A, user.email);
    await loginApp(jarOne, APP_B, user.email);
    await loginAuth(jarTwo, user.email);

    const centralSession = await expectCentralActive(jarOne, "central session before admin password change");
    const activeTokensBefore = await client.query(
      "select count(*)::int as count from access_tokens where user_id = $1 and status = 'active'",
      [user.id]
    );

    assert.ok(activeTokensBefore.rows[0].count >= 2);

    await postJson(`${ADMIN}/admin/users/${user.id}/password`, {
      password: newPassword
    });

    await expectCentralRevoked(jarOne, "central session one should be revoked");
    await expectCentralRevoked(jarTwo, "central session two should be revoked");
    await waitFor(() => expectAppLoggedOut(jarOne, APP_A, "App A should be revoked"), "App A password revocation");
    await waitFor(() => expectAppLoggedOut(jarOne, APP_B, "App B should be revoked"), "App B password revocation");

    const activeSessions = await client.query(
      "select count(*)::int as count from sso_sessions where user_id = $1 and status = 'active'",
      [user.id]
    );
    const activeTokens = await client.query(
      "select count(*)::int as count from access_tokens where user_id = $1 and status = 'active'",
      [user.id]
    );
    const event = await client.query(
      `select id, event_type, user_id, central_session_id, application_id, payload, created_at
       from events
       where user_id = $1 and central_session_id = $2 and event_type = 'PasswordChanged'
       order by created_at desc
       limit 1`,
      [user.id, centralSession.session.id]
    );

    assert.equal(activeSessions.rows[0].count, 0);
    assert.equal(activeTokens.rows[0].count, 0);
    assert.equal(event.rowCount, 1);
    expectMinimumEventPayload(event.rows[0], {
      eventType: "PasswordChanged",
      userId: user.id,
      centralSessionId: centralSession.session.id,
      reason: "password_changed"
    });
    await expectProcessedEvent(appAClient, "app-a", event.rows[0].id, "PasswordChanged");
    await expectProcessedEvent(appBClient, "app-b", event.rows[0].id, "PasswordChanged");

    const oldPasswordLogin = await new CookieJar().fetch(`${AUTH}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form({
        email: user.email,
        password: PASSWORD
      })
    });

    assert.equal(oldPasswordLogin.status, 401);
    await loginAuth(new CookieJar(), user.email, newPassword);
  } finally {
    await cleanupUser(user.id);
  }
});

test("user password change from relying app link revokes all sessions and updates credentials", async () => {
  const user = await createTempUser([appAGroup, appBGroup], "self-password");
  const newPassword = "self-new-password-123";

  try {
    const jar = new CookieJar();

    await loginApp(jar, APP_A, user.email);
    await loginApp(jar, APP_B, user.email);

    const appHome = await jar.fetch(`${APP_A}/`);
    const appHomeText = await appHome.text();

    assert.match(appHomeText, /Change Password/);
    assert.match(appHomeText, new RegExp(`${AUTH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/password`));

    const page = await jar.fetch(`${AUTH}/password`);
    const pageText = await page.text();

    assert.equal(page.status, 200);
    assert.match(pageText, /Change Password/);

    const response = await jar.fetch(`${AUTH}/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        currentPassword: PASSWORD,
        newPassword,
        confirmPassword: newPassword
      })
    });

    await expectJsonStatus(response, 200);
    await expectCentralRevoked(jar, "central session should be revoked after self password change");
    await waitFor(() => expectAppLoggedOut(jar, APP_A, "App A should be revoked after self password change"), "App A self password revocation");
    await waitFor(() => expectAppLoggedOut(jar, APP_B, "App B should be revoked after self password change"), "App B self password revocation");

    const oldPasswordLogin = await new CookieJar().fetch(`${AUTH}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form({
        email: user.email,
        password: PASSWORD
      })
    });

    assert.equal(oldPasswordLogin.status, 401);
    await loginAuth(new CookieJar(), user.email, newPassword);
  } finally {
    await cleanupUser(user.id);
  }
});

test("application inactive revokes targeted app local sessions and blocks new authorization", async () => {
  const user = await createTempUser([appAGroup, appBGroup], "app-inactive");

  try {
    await patchJson(`${ADMIN}/admin/applications/${appA.id}`, {
      status: "ACTIVE"
    });

    const jar = new CookieJar();

    await loginApp(jar, APP_A, user.email);
    await loginApp(jar, APP_B, user.email);
    await patchJson(`${ADMIN}/admin/applications/${appA.id}`, {
      status: "INACTIVE"
    });

    await waitFor(() => expectAppLoggedOut(jar, APP_A, "App A should be revoked when inactive"), "App A inactive revocation");
    await expectAppActive(jar, APP_B, "App B should stay active when App A is inactive");

    const authJar = new CookieJar();

    await loginAuth(authJar, user.email);

    const url = new URL(`${AUTH}/authorize`);

    url.searchParams.set("client_id", "app-a");
    url.searchParams.set("redirect_uri", "http://localhost:3001/callback");
    url.searchParams.set("state", "inactive-test");
    url.searchParams.set("code_challenge", codeChallenge("inactive-verifier"));
    url.searchParams.set("code_challenge_method", "S256");

    const response = await authJar.fetch(url.toString());
    const body = await expectJsonStatus(response, 400);

    assert.equal(body.error.code, "INVALID_CLIENT");
  } finally {
    await patchJson(`${ADMIN}/admin/applications/${appA.id}`, {
      status: "ACTIVE"
    });
    await cleanupUser(user.id);
  }
});

test("group membership removal revokes only the targeted app and blocks new access", async () => {
  const user = await createTempUser([appAGroup, appBGroup], "policy");

  try {
    const jar = new CookieJar();

    await loginApp(jar, APP_A, user.email);
    await loginApp(jar, APP_B, user.email);
    const centralSession = await expectCentralActive(jar, "central session before policy removal");
    const activeTokensBefore = await client.query(
      "select count(*)::int as count from access_tokens where user_id = $1 and status = 'active'",
      [user.id]
    );
    const verifier = `policy-verifier-${Date.now()}`;
    const code = await getAuthorizationCode(
      jar,
      "app-a",
      "http://localhost:3001/callback",
      verifier
    );
    const issuedToken = await tokenRequest({
      client_id: "app-a",
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: "http://localhost:3001/callback",
      code_verifier: verifier
    });

    assert.ok(activeTokensBefore.rows[0].count >= 2);
    assert.equal(issuedToken.response.status, 200, issuedToken.text);

    await deleteJson(`${ADMIN}/admin/groups/${appAGroup.id}/users/${user.id}`);

    await waitFor(() => expectAppLoggedOut(jar, APP_A, "App A should be revoked"), "App A group removal revocation");
    await expectAppActive(jar, APP_B, "App B should stay active");
    await expectCentralRevoked(jar, "central session should be revoked after policy access loss");

    let response = await jar.fetch(`${APP_A}/login`);
    response = await jar.fetch(redirectLocation(response));
    const loginUrl = redirectLocation(response);
    const returnTo = new URL(loginUrl).searchParams.get("returnTo");

    assert.ok(returnTo, "Auth login URL should include returnTo");
    await loginAuth(jar, user.email);
    response = await jar.fetch(new URL(returnTo, AUTH).toString());
    response = await jar.fetch(redirectLocation(response));

    assert.equal(response.status, 400, await response.text());

    const userinfoAfterPolicyLoss = await fetch(`${AUTH}/userinfo?client_id=app-a`, {
      headers: {
        authorization: `Bearer ${issuedToken.data.access_token}`
      }
    });

    assert.equal(userinfoAfterPolicyLoss.status, 401);

    const activeTokensAfter = await client.query(
      "select count(*)::int as count from access_tokens where user_id = $1 and status = 'active'",
      [user.id]
    );
    const event = await client.query(
      `select id, event_type, user_id, central_session_id, application_id, payload, created_at
       from events
       where user_id = $1
         and central_session_id = $2
         and application_id = $3
         and event_type = 'AccessPolicyChanged'
       order by created_at desc
       limit 1`,
      [user.id, centralSession.session.id, appA.id]
    );

    assert.equal(activeTokensAfter.rows[0].count, 0);
    assert.equal(event.rowCount, 1);
    expectMinimumEventPayload(event.rows[0], {
      eventType: "AccessPolicyChanged",
      userId: user.id,
      centralSessionId: centralSession.session.id,
      applicationId: appA.id,
      reason: "group_membership_removed"
    });

    const deliveries = await client.query(
      "select application_id from event_deliveries where event_id = $1",
      [event.rows[0].id]
    );
    const deliveryApplicationIds = new Set(deliveries.rows.map((row) => row.application_id));

    assert.ok(deliveryApplicationIds.has(appA.id));
    assert.equal(deliveryApplicationIds.has(appB.id), false);
    await expectProcessedEvent(appAClient, "app-a", event.rows[0].id, "AccessPolicyChanged");

    await loginApp(new CookieJar(), APP_B, user.email);
  } finally {
    await cleanupUser(user.id);
  }
});

test("group membership removal keeps local session when another group still allows the app", async () => {
  const alternateGroup = await postJson(`${ADMIN}/admin/groups`, {
    name: `alternate-app-a-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    description: "Alternate App A access"
  });
  const user = await createTempUser([appAGroup, alternateGroup], "policy-unchanged");

  try {
    await postJson(`${ADMIN}/admin/applications/${appA.id}/policies`, {
      groupId: alternateGroup.id,
      effect: "ALLOW"
    });

    const jar = new CookieJar();

    await loginApp(jar, APP_A, user.email);
    await deleteJson(`${ADMIN}/admin/groups/${appAGroup.id}/users/${user.id}`);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expectAppActive(jar, APP_A, "App A should stay active through alternate group");
    await expectCentralActive(jar, "central session should stay active through alternate group");

    const events = await client.query(
      "select count(*)::int as count from events where user_id = $1 and application_id = $2 and event_type = 'AccessPolicyChanged'",
      [user.id, appA.id]
    );

    assert.equal(events.rows[0].count, 0);
  } finally {
    await cleanupUser(user.id);
    await deleteJson(`${ADMIN}/admin/groups/${alternateGroup.id}`);
  }
});

test("worker retries a transient delivery failure and sends minimum event payload", { timeout: 60000 }, async () => {
  const probe = startLogoutProbe(1);
  const logoutNotificationUrl = await probe.listen();
  const probeApp = await postJson(`${ADMIN}/admin/applications`, {
    name: "Probe Retry App",
    clientId: `probe-retry-${Date.now()}`,
    clientSecret: CLIENT_SECRET,
    status: "ACTIVE",
    logoutNotificationUrl
  });
  const user = await createTempUser([], "probe-retry");
  const eventId = randomUUID();
  const deliveryId = randomUUID();

  tempApplicationIds.add(probeApp.id);

  try {
    await client.query(
      `insert into events (id, event_type, user_id, application_id, payload, status, created_at)
       values ($1, 'AccessPolicyChanged', $2, $3, $4::jsonb, 'pending', now())`,
      [
        eventId,
        user.id,
        probeApp.id,
        JSON.stringify({
          reason: "transient_probe",
          userId: user.id,
          applicationId: probeApp.id
        })
      ]
    );
    await client.query(
      `insert into event_deliveries (id, event_id, application_id, status)
       values ($1, $2, $3, 'pending')`,
      [deliveryId, eventId, probeApp.id]
    );

    await waitFor(async () => {
      const delivery = await client.query(
        "select status, attempt_count, last_attempt_at, next_retry_at from event_deliveries where id = $1",
        [deliveryId]
      );

      assert.equal(delivery.rows[0].status, "retrying");
      assert.equal(delivery.rows[0].attempt_count, 1);
      assert.ok(delivery.rows[0].next_retry_at > delivery.rows[0].last_attempt_at);
      assert.equal(probe.requests.length, 1);
    }, "transient delivery first retry");

    const firstPayload = probe.requests[0].body;
    const serializedPayload = JSON.stringify(firstPayload);

    assert.equal(firstPayload.eventId, eventId);
    assert.equal(firstPayload.eventType, "AccessPolicyChanged");
    assert.equal(firstPayload.userId, user.id);
    assert.equal(firstPayload.applicationId, probeApp.id);
    assert.equal(firstPayload.reason, "transient_probe");
    assert.ok(Date.parse(firstPayload.occurredAt));
    assert.equal(firstPayload.payload.reason, "transient_probe");
    assert.doesNotMatch(serializedPayload, /secret|token|password/i);

    await client.query("update event_deliveries set next_retry_at = now() where id = $1", [
      deliveryId
    ]);

    await waitFor(async () => {
      const delivery = await client.query(
        "select status, attempt_count from event_deliveries where id = $1",
        [deliveryId]
      );

      assert.equal(delivery.rows[0].status, "succeeded");
      assert.equal(delivery.rows[0].attempt_count, 1);
      assert.ok(probe.requests.length >= 2);
    }, "transient delivery eventually succeeds");
  } finally {
    await probe.close();
    await cleanupUser(user.id);
    await cleanupApplication(probeApp.id);
  }
});

test("pending events survive while sync worker is stopped and process after restart", { timeout: 90000 }, async () => {
  const user = await createTempUser([appAGroup, appBGroup], "worker-stopped");
  const jar = new CookieJar();
  let eventId;

  try {
    await loginApp(jar, APP_A, user.email);
    await loginApp(jar, APP_B, user.email);

    const session = await expectCentralActive(jar, "central session before worker stop");

    dockerCompose(["stop", "sync-worker"]);

    try {
      const response = await jar.fetch(`${AUTH}/logout-sso`, {
        method: "POST"
      });

      assert.equal(response.status, 200);

      const event = await client.query(
        `select id
         from events
         where user_id = $1 and central_session_id = $2 and event_type = 'SessionRevoked'
         order by created_at desc
         limit 1`,
        [user.id, session.session.id]
      );

      assert.equal(event.rowCount, 1);
      eventId = event.rows[0].id;

      const deliveries = await client.query(
        "select application_id, status from event_deliveries where event_id = $1",
        [eventId]
      );
      const statusesByApp = new Map(
        deliveries.rows.map((delivery) => [delivery.application_id, delivery.status])
      );

      assert.equal(statusesByApp.get(appA.id), "pending");
      assert.equal(statusesByApp.get(appB.id), "pending");

      const [appASessions, appBSessions] = await Promise.all([
        appAClient.query(
          "select count(*)::int as count from local_sessions where external_user_id = $1 and status = 'active'",
          [user.id]
        ),
        appBClient.query(
          "select count(*)::int as count from local_sessions where external_user_id = $1 and status = 'active'",
          [user.id]
        )
      ]);

      assert.ok(appASessions.rows[0].count >= 1);
      assert.ok(appBSessions.rows[0].count >= 1);
    } finally {
      dockerCompose(["start", "sync-worker"]);
      await waitWorkerHealthy();
    }

    await expectProcessedEvent(appAClient, "app-a", eventId, "SessionRevoked");
    await expectProcessedEvent(appBClient, "app-b", eventId, "SessionRevoked");

    await waitFor(async () => {
      const [appASessions, appBSessions] = await Promise.all([
        appAClient.query(
          "select count(*)::int as count from local_sessions where external_user_id = $1 and status = 'active'",
          [user.id]
        ),
        appBClient.query(
          "select count(*)::int as count from local_sessions where external_user_id = $1 and status = 'active'",
          [user.id]
        )
      ]);

      assert.equal(appASessions.rows[0].count, 0);
      assert.equal(appBSessions.rows[0].count, 0);
    }, "stopped worker event processed after restart");
  } finally {
    try {
      dockerCompose(["start", "sync-worker"]);
      await waitWorkerHealthy();
    } catch {
      // Best effort: the assertion failure should be reported by the test body.
    }

    await cleanupUser(user.id);
  }
});

test("worker recovers stale processing deliveries", async () => {
  const user = await createTempUser([appAGroup], "stale-processing");

  try {
    const jar = new CookieJar();
    const eventId = randomUUID();
    const deliveryId = randomUUID();

    await loginApp(jar, APP_A, user.email);
    await client.query(
      `insert into events (id, event_type, user_id, application_id, payload, status, created_at)
       values ($1, 'AccessPolicyChanged', $2, $3, $4::jsonb, 'pending', now())`,
      [
        eventId,
        user.id,
        appA.id,
        JSON.stringify({
          reason: "stale_processing_test",
          userId: user.id,
          applicationId: appA.id
        })
      ]
    );
    await client.query(
      `insert into event_deliveries
       (id, event_id, application_id, status, attempt_count, last_attempt_at)
       values ($1, $2, $3, 'processing', 0, now() - interval '10 minutes')`,
      [deliveryId, eventId, appA.id]
    );

    await waitFor(
      () => expectAppLoggedOut(jar, APP_A, "App A should be revoked after stale delivery recovery"),
      "stale processing recovery"
    );

    const delivery = await client.query(
      "select status from event_deliveries where id = $1",
      [deliveryId]
    );

    assert.equal(delivery.rows[0].status, "succeeded");
  } finally {
    await cleanupUser(user.id);
  }
});

test("worker drains an in-flight delivery before graceful shutdown", { timeout: 90000 }, async () => {
  const responseDelayMs = 3000;
  const probe = startLogoutProbe(0, responseDelayMs);
  const logoutNotificationUrl = await probe.listen();
  const probeApp = await postJson(`${ADMIN}/admin/applications`, {
    name: "Probe In-Flight App",
    clientId: `probe-inflight-${Date.now()}`,
    clientSecret: CLIENT_SECRET,
    status: "ACTIVE",
    logoutNotificationUrl
  });
  const user = await createTempUser([], "inflight-shutdown");
  const eventId = randomUUID();
  const deliveryId = randomUUID();

  tempApplicationIds.add(probeApp.id);

  try {
    await client.query(
      `insert into events (id, event_type, user_id, application_id, payload, status, created_at)
       values ($1, 'SessionRevoked', $2, $3, $4::jsonb, 'pending', now())`,
      [
        eventId,
        user.id,
        probeApp.id,
        JSON.stringify({
          eventId,
          eventType: "SessionRevoked",
          userId: user.id,
          applicationId: probeApp.id,
          reason: "inflight_shutdown_test",
          occurredAt: new Date().toISOString(),
          metadata: {}
        })
      ]
    );
    await client.query(
      `insert into event_deliveries (id, event_id, application_id, status)
       values ($1, $2, $3, 'pending')`,
      [deliveryId, eventId, probeApp.id]
    );

    await waitFor(async () => {
      const delivery = await client.query(
        "select status from event_deliveries where id = $1",
        [deliveryId]
      );

      assert.equal(probe.requests.length, 1);
      assert.equal(delivery.rows[0]?.status, "processing");
    }, "delivery entered in-flight processing");

    const shutdownStartedAt = Date.now();
    await dockerComposeAsync(["stop", "-t", "30", "sync-worker"]);
    const shutdownDurationMs = Date.now() - shutdownStartedAt;
    const containerName = "centralized-identity-authorization-provider-sync-worker-1";
    const { stdout: inspectOutput } = await execFileAsync("docker", [
      "inspect",
      "-f",
      "{{.State.ExitCode}}",
      containerName
    ]);
    const { stdout: logs } = await execFileAsync("docker", [
      "compose",
      "logs",
      "--no-color",
      "sync-worker"
    ], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024
    });
    const delivery = await client.query(
      "select status, processed_at from event_deliveries where id = $1",
      [deliveryId]
    );

    assert.ok(shutdownDurationMs >= responseDelayMs - 500);
    assert.equal(inspectOutput.trim(), "0");
    assert.match(logs, /Graceful shutdown completed/);
    assert.equal(delivery.rows[0]?.status, "succeeded");
    assert.ok(delivery.rows[0]?.processed_at);

    dockerCompose(["start", "sync-worker"]);
    await waitWorkerHealthy();
  } finally {
    try {
      dockerCompose(["start", "sync-worker"]);
      await waitWorkerHealthy();
    } catch {
      // Best effort: keep the assertion failure while restoring the worker.
    }
    await probe.close();
    await cleanupUser(user.id);
    await cleanupApplication(probeApp.id);
  }
});

test("worker retries failing delivery and sends it to DLQ", { timeout: 90000 }, async () => {
  await purgeQueue("revocation.deliveries");
  await purgeQueue("revocation.deliveries.dlq");

  const badApp = await postJson(`${ADMIN}/admin/applications`, {
    name: "Bad Retry App",
    clientId: `bad-retry-${Date.now()}`,
    clientSecret: CLIENT_SECRET,
    status: "ACTIVE",
    logoutNotificationUrl: "http://127.0.0.1:9/internal/logout"
  });
  const user = await createTempUser([appAGroup], "retry");

  tempApplicationIds.add(badApp.id);

  try {
    const jar = new CookieJar();

    await loginApp(jar, APP_A, user.email);
    await postJson(`${ADMIN}/admin/users/${user.id}/password`, {
      password: "new-password-123"
    });

    await waitFor(async () => {
      const delivery = await client.query(
        "select status, attempt_count from event_deliveries where application_id = $1 order by last_attempt_at desc nulls last limit 1",
        [badApp.id]
      );

      assert.equal(delivery.rows[0]?.status, "failed");
      assert.equal(delivery.rows[0]?.attempt_count, 5);
    }, "bad app delivery failed", 45000);

    const event = await client.query(
      `select id
       from events
       where user_id = $1 and event_type = 'PasswordChanged'
       order by created_at desc
       limit 1`,
      [user.id]
    );
    const deliveries = await client.query(
      "select application_id, status from event_deliveries where event_id = $1",
      [event.rows[0].id]
    );
    const statusesByApp = new Map(
      deliveries.rows.map((delivery) => [delivery.application_id, delivery.status])
    );

    assert.equal(statusesByApp.get(appA.id), "succeeded");
    assert.equal(statusesByApp.get(appB.id), "succeeded");
    assert.equal(statusesByApp.get(badApp.id), "failed");

    await waitFor(async () => {
      const queues = await getQueues();
      const dlq = queues.find((queue) => queue.name === "revocation.deliveries.dlq");
      const messages =
        (dlq?.messages ?? 0) +
        (dlq?.messages_ready ?? 0) +
        (dlq?.messages_unacknowledged ?? 0);

      assert.ok(messages >= 1, "DLQ should contain failed delivery");
    }, "DLQ message visible", 10000);

    await purgeQueue("revocation.deliveries.dlq");
  } finally {
    await cleanupUser(user.id);
    await cleanupApplication(badApp.id);
  }
});
