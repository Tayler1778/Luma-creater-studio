import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const defaultRedirectUri = `http://localhost:${port}/auth/twitch/callback`;

async function loadLocalEnvironment() {
  try {
    const contents = await readFile(resolve(root, ".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || Object.hasOwn(process.env, match[1])) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadLocalEnvironment();

const clientId = process.env.TWITCH_CLIENT_ID?.trim();
const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
const redirectUri = (process.env.TWITCH_REDIRECT_URI || defaultRedirectUri).trim();
const configured = Boolean(clientId && clientSecret);
const expectedOrigin = new URL(redirectUri).origin;
const sessions = new Map();
const sessionDurationSeconds = 60 * 60 * 24;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function setCookie(response, name, value, maxAge) {
  const attributes = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (new URL(redirectUri).protocol === "https:") attributes.push("Secure");
  response.setHeader("Set-Cookie", attributes.join("; "));
}

function clearCookie(response, name) {
  setCookie(response, name, "", 0);
}

function readCookies(request) {
  return Object.fromEntries(
    (request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s, 2))
      .filter(([name, value]) => name && value !== undefined)
      .map(([name, value]) => [name, decodeURIComponent(value)])
  );
}

function secureEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function getSession(request) {
  const sessionId = readCookies(request).luma_session;
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { sessionId, ...session };
}

function redirect(response, location) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

async function exchangeCode(code) {
  const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    })
  });

  if (!tokenResponse.ok) {
    throw new Error(`Twitch token exchange failed (${tokenResponse.status}).`);
  }
  const token = await tokenResponse.json();
  if (typeof token.access_token !== "string" || !Number.isFinite(token.expires_in)) {
    throw new Error("Twitch returned an invalid access token response.");
  }

  const userResponse = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Client-Id": clientId
    }
  });
  if (!userResponse.ok) {
    throw new Error(`Twitch user lookup failed (${userResponse.status}).`);
  }
  const userResult = await userResponse.json();
  const user = userResult.data?.[0];
  if (!user || typeof user.id !== "string" || typeof user.login !== "string") {
    throw new Error("Twitch did not return a valid user profile.");
  }

  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    user: {
      id: user.id,
      login: user.login,
      displayName: user.display_name || user.login,
      profileImageUrl: user.profile_image_url || ""
    }
  };
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, redirectUri);
  const cookies = readCookies(request);

  if (request.method === "GET" && requestUrl.pathname === "/api/auth/config") {
    sendJson(response, 200, { configured });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/auth/me") {
    const session = getSession(request);
    if (!session) {
      sendJson(response, 200, { authenticated: false });
      return;
    }
    sendJson(response, 200, { authenticated: true, user: session.user });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/stream") {
    const session = getSession(request);
    if (!session) {
      sendJson(response, 200, { authenticated: false, live: false });
      return;
    }
    try {
      const twitchUrl = new URL("https://api.twitch.tv/helix/streams");
      twitchUrl.searchParams.set("user_id", session.user.id);
      const streamResponse = await fetch(twitchUrl, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Client-Id": clientId
        }
      });
      if (!streamResponse.ok) {
        console.error(`Twitch stream lookup failed (${streamResponse.status}).`);
        sendJson(response, 502, { error: "Could not load the Twitch stream status." });
        return;
      }
      const result = await streamResponse.json();
      const stream = result.data?.[0];
      sendJson(response, 200, {
        authenticated: true,
        live: Boolean(stream),
        user: session.user,
        stream: stream ? {
          title: stream.title,
          gameName: stream.game_name,
          viewerCount: stream.viewer_count,
          startedAt: stream.started_at
        } : null
      });
    } catch (error) {
      console.error("Twitch stream lookup failed:", error.message);
      sendJson(response, 502, { error: "Could not reach Twitch to check stream status." });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/auth/login") {
    if (!configured) {
      sendJson(response, 503, { error: "Twitch OAuth is not configured. Add the credentials to .env." });
      return;
    }
    const state = randomBytes(32).toString("hex");
    setCookie(response, "luma_oauth_state", state, 600);
    const authorizationUrl = new URL("https://id.twitch.tv/oauth2/authorize");
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state
    }).toString();
    redirect(response, authorizationUrl);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/auth/twitch/callback") {
    const state = requestUrl.searchParams.get("state");
    const savedState = cookies.luma_oauth_state;
    clearCookie(response, "luma_oauth_state");
    if (!state || !savedState || !secureEquals(state, savedState)) {
      redirect(response, "/?auth_error=invalid_state");
      return;
    }
    if (requestUrl.searchParams.has("error")) {
      redirect(response, "/?auth_error=cancelled");
      return;
    }
    const code = requestUrl.searchParams.get("code");
    if (!configured || !code) {
      redirect(response, "/?auth_error=oauth_failed");
      return;
    }

    try {
      const session = await exchangeCode(code);
      const sessionId = randomBytes(32).toString("hex");
      sessions.set(sessionId, session);
      setCookie(response, "luma_session", sessionId, sessionDurationSeconds);
      redirect(response, "/?auth=connected");
    } catch (error) {
      console.error("Twitch sign-in failed:", error.message);
      redirect(response, "/?auth_error=oauth_failed");
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/auth/logout") {
    if (request.headers.origin !== expectedOrigin) {
      sendJson(response, 403, { error: "Request origin is not allowed." });
      return;
    }
    const session = getSession(request);
    if (session) sessions.delete(session.sessionId);
    clearCookie(response, "luma_session");
    sendJson(response, 200, { authenticated: false });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  const filePath = resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const contentType = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).on("error", () => {
      if (!response.headersSent) response.writeHead(404);
      response.end("Not found");
    }).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    console.error("Static file request failed:", error.message);
    response.writeHead(500);
    response.end("Internal server error");
  }
});

server.listen(port, host, () => {
  console.log(`luma is listening on ${host}:${port}`);
  console.log(configured ? "Twitch OAuth is configured." : "Twitch OAuth needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env.");
});
