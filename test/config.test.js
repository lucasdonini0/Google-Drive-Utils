const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadOAuthConfig } = require("../src/main/config");

test("loads downloaded Google desktop credentials", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gdu-config-"));
  const file = path.join(directory, "oauth_client.json");
  fs.writeFileSync(file, JSON.stringify({ installed: { client_id: "client", client_secret: "secret" } }));
  try {
    assert.deepEqual(loadOAuthConfig([file]), { clientId: "client", clientSecret: "secret" });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reports missing credentials clearly", () => {
  assert.throws(() => loadOAuthConfig([path.join(os.tmpdir(), "missing-oauth-client.json")]), /not been configured/);
});

test("finds credentials next to a portable executable", () => {
  const previous = process.env.PORTABLE_EXECUTABLE_DIR;
  process.env.PORTABLE_EXECUTABLE_DIR = "C:\\PortableApp";
  const { oauthConfigPaths } = require("../src/main/config");
  try {
    assert.ok(oauthConfigPaths({ appPath: "C:\\App", resourcesPath: "C:\\Resources" }).includes("C:\\PortableApp\\oauth_client.json"));
  } finally {
    if (previous === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
    else process.env.PORTABLE_EXECUTABLE_DIR = previous;
  }
});
