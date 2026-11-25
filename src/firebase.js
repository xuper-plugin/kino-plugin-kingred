// @ts-check
/// <reference path="../kino.d.ts" />
// KingRed's Firebase client: anonymous sign-in and Storage download. The per-title stream JSON files
// (SourcesM/<tmdb>.json for movies, SourcesT/<tmdb>.json for series) live in the duo-play Firebase
// Storage bucket behind an anonymous Firebase session; there is no account to log in with.
//
//   idToken()          signs up anonymously, caches { token, exp } in kino.storage and reuses the
//                      token while it is still valid (a 5-minute safety margin before `exp`).
//   storageJson(path)  GET firebasestorage.../o/<encodeURIComponent(path)>?alt=media with the token,
//                      renewing once on a 401/403 and retrying before giving up.
//
// Renewal is a fresh anonymous signUp (identitytoolkit, a declared host), NOT a refresh-token exchange
// against securetoken.googleapis.com -- that host is not in the manifest, so a refresh would be refused.

/** Firebase Web API key for the duo-play project (public, shipped in the app). */
const API_KEY = "AIzaSyCEvQwLPt1CFDPCVy1bLptJ6SzO356G3sk";

/** Anonymous sign-up endpoint; the key rides in the query string. */
const SIGNUP_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;

/** Storage object download base: `<STORAGE_BASE><encodeURIComponent(path)>?alt=media`. */
const STORAGE_BASE = "https://firebasestorage.googleapis.com/v0/b/duo-play.appspot.com/o/";

/** kino.storage key for the cached `{ token, exp }`. Exported so the settings clearCache action can drop it. */
export const TOKEN_KEY = "kingred:fbToken";

/** Treat the token as expired this long before its real expiry, so a request never races the clock. */
const SAFETY_MS = 5 * 60 * 1000;

/** Reads the cached `{ token, exp }`, or null when absent or unparseable. */
function readCachedToken() {
  const raw = kino.storage.get(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === "string" && typeof parsed.exp === "number") return parsed;
  } catch {
    /* fall through: a corrupt entry is treated as no token */
  }
  return null;
}

/**
 * Signs up anonymously, caches the fresh `{ token, exp }` and returns the token. Always hits the
 * network: callers that want the cache use `idToken()`.
 * @returns {Promise<string>}
 */
async function renewToken() {
  const res = await kino.fetch(SIGNUP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`Firebase signUp failed: HTTP ${res.status}`);

  const body = res.json();
  const token = body && body.idToken;
  if (!token || typeof token !== "string") throw new Error("Firebase signUp: no idToken in response");

  const expiresIn = Number(body && body.expiresIn);
  const ttlMs = (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000;
  const exp = Date.now() + ttlMs;

  kino.storage.set(TOKEN_KEY, JSON.stringify({ token, exp }));
  return token;
}

/**
 * The current anonymous Firebase idToken, from the cache while it is valid (5-minute margin before
 * expiry) or from a fresh anonymous sign-up otherwise.
 * @returns {Promise<string>}
 */
export async function idToken() {
  const cached = readCachedToken();
  if (cached && Date.now() < cached.exp - SAFETY_MS) return cached.token;
  return renewToken();
}

/** One Storage GET for `path` with the given token in the `Authorization: Firebase <token>` header. */
function storageGet(path, token) {
  const url = STORAGE_BASE + encodeURIComponent(path) + "?alt=media";
  return kino.fetch(url, { headers: { Authorization: `Firebase ${token}` } });
}

/**
 * Downloads a Storage object (e.g. "SourcesM/1263337.json") and parses it as JSON. On a 401/403 it
 * forces one token renewal (bypassing the cache) and retries; a second failure throws.
 * @param {string} path
 * @returns {Promise<any>}
 */
export async function storageJson(path) {
  let res = await storageGet(path, await idToken());

  if (res.status === 401 || res.status === 403) {
    res = await storageGet(path, await renewToken());
  }

  if (!res.ok) throw new Error(`Firebase storage ${res.status} for ${path}`);
  return res.json();
}
