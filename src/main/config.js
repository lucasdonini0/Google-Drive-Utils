const fs = require("node:fs");
const path = require("node:path");

function oauthConfigPaths({ appPath, resourcesPath }) {
  return [
    process.env.GOOGLE_OAUTH_CONFIG,
    process.env.PORTABLE_EXECUTABLE_DIR
      ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "oauth_client.json")
      : "",
    path.join(appPath, "oauth_client.json"),
    path.join(resourcesPath, "oauth_client.json"),
    path.join(path.dirname(process.execPath), "oauth_client.json"),
  ].filter(Boolean);
}

function loadOAuthConfig(paths) {
  if (process.env.GOOGLE_OAUTH_CLIENT_ID) {
    return {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    };
  }

  const configPath = paths.find((candidate) => fs.existsSync(candidate));
  if (!configPath) {
    throw new Error(
      "Google sign-in has not been configured yet. Add oauth_client.json next to the app."
    );
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const config = parsed.installed || parsed;
  if (!config.client_id) {
    throw new Error("oauth_client.json does not contain a desktop client ID.");
  }

  return { clientId: config.client_id, clientSecret: config.client_secret || "" };
}

module.exports = { loadOAuthConfig, oauthConfigPaths };
