// The resolver door helper (src/resolve-door.js): the seam that sends each hoster embed to the shared
// kino-resolver through its provider door (`kino.plugins.call("resolver","resolve",...)`), reshapes the
// answer into open()'s { url, mime, headers?, captured?, subtitles? }, and -- only when the door comes back
// empty and not `dead` -- falls back to a WebView capture via `kino.browser.capture`. A `doorKino` mock
// drives both the door and the capture.
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveViaHelper, resolverInstalled } from "../src/resolve-door.js";

const HLS_MIME = "application/vnd.apple.mpegurl";

// The resolver-door calls this consumer declares (resolve + the install probe normalizeHost). The mocked door
// models the real protocol with them: Kino checks the DECLARED call list BEFORE provider existence, so a call
// outside this set throws not_declared, and only a declared call reaches the provider (and its answers/errors).
const DECLARED_CALLS = new Set(["resolve", "normalizeHost"]);

// A kino whose door (`plugins.call`) and hidden WebView (`browser.capture`) are both programmable.
// `door` maps an embed url to the resolver's answer; `capture` maps an embed url to a capture result.
function doorKino({ door = {}, capture = {} } = {}) {
  const calls = { door: [], capture: [] };
  return {
    kino: {
      log() {},
      plugins: {
        call: async (alias, name, arg) => {
          if (!DECLARED_CALLS.has(name)) throw Object.assign(new Error("not_declared"), { code: "not_declared" });
          calls.door.push({ name, arg });
          const answer = door[arg.url];
          if (answer instanceof Error) throw answer;
          if (name === "normalizeHost") return answer || { host: "" };
          return answer || { streams: [], error: "needs_browser" };
        },
      },
      browser: {
        capture: async (url, opts) => {
          calls.capture.push({ url, opts });
          return capture[url] || { media: [] };
        },
      },
    },
    calls,
  };
}

test("an embed the door resolves to .m3u8 comes back as an HLS stream", async () => {
  const embed = "https://a.example/e/1";
  const { kino, calls } = doorKino({
    door: { [embed]: { streams: [{ url: "https://cdn/b.m3u8", server: "bhost", referer: "https://a.example/" }] } },
  });
  const s = await resolveViaHelper(embed, kino, "https://a.example/");
  assert.equal(s.url, "https://cdn/b.m3u8");
  assert.equal(s.mime, HLS_MIME);
  assert.equal(s.headers.Referer, "https://a.example/");
  assert.equal(s.captured, undefined);
  assert.deepEqual(calls.capture, [], "a door answer never triggers a capture");
});

test("a dead player returns null without ever opening the WebView", async () => {
  const embed = "https://a.example/e/dead";
  const { kino, calls } = doorKino({ door: { [embed]: { streams: [], error: "dead" } } });
  const s = await resolveViaHelper(embed, kino, "https://a.example/");
  assert.equal(s, null);
  assert.deepEqual(calls.capture, [], "a dead player is never captured");
});

test("needs_browser falls back to a WebView capture and marks the result captured", async () => {
  const embed = "https://a.example/e/slow";
  const { kino, calls } = doorKino({
    door: { [embed]: { streams: [], error: "needs_browser" } },
    capture: { [embed]: { media: [{ url: "https://cdn/cap.m3u8", headers: { Referer: "https://a.example/" } }] } },
  });
  const s = await resolveViaHelper(embed, kino, "https://a.example/", true);
  assert.equal(s.url, "https://cdn/cap.m3u8");
  assert.equal(s.mime, HLS_MIME);
  assert.equal(s.captured, true);
  assert.equal(calls.capture.length, 1, "the WebView is opened exactly once");
  assert.equal(calls.capture[0].url, embed);
});

test("needs_browser does not capture when allowCapture is false", async () => {
  const embed = "https://a.example/e/slow";
  const { kino, calls } = doorKino({ door: { [embed]: { streams: [], error: "needs_browser" } } });
  const s = await resolveViaHelper(embed, kino, "https://a.example/", false);
  assert.equal(s, null);
  assert.deepEqual(calls.capture, []);
});

test("the door throws not_declared for a call the manifest does not declare (protocol order)", async () => {
  // This is the regression the install gate depends on: Kino rejects an UNDECLARED call with not_declared
  // before it ever looks for the provider. So the install probe (normalizeHost) HAS to be a declared call --
  // otherwise its absent-resolver error would be not_declared, which resolverInstalled() reads as "installed".
  const { kino } = doorKino();
  await assert.rejects(
    () => kino.plugins.call("resolver", "rank", { url: "https://x.example/" }),
    (err) => { assert.equal(err.code, "not_declared"); return true; },
  );
});

test("resolverInstalled is false only when the declared probe yields provider_missing", async () => {
  const probe = "https://probe.invalid/";
  // The probe (normalizeHost) is a declared call, so an absent resolver surfaces as provider_missing -> false.
  const missing = doorKino({ door: { [probe]: Object.assign(new Error("missing"), { code: "provider_missing" }) } });
  assert.equal(await resolverInstalled(missing.kino), false);

  const present = doorKino({ door: { [probe]: { host: "probe.invalid" } } });
  assert.equal(await resolverInstalled(present.kino), true);

  const otherError = doorKino({ door: { [probe]: Object.assign(new Error("boom"), { code: "provider_failed" }) } });
  assert.equal(await resolverInstalled(otherError.kino), true, "any error that is not provider_missing still means installed");
});
