const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
];

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

class OAuthManager {
  constructor({ app, safeStorage, shell, getConfig }) {
    this.safeStorage = safeStorage;
    this.shell = shell;
    this.getConfig = getConfig;
    this.tokenPath = path.join(app.getPath("userData"), "auth-token.bin");
    this.tokens = null;
    this.profile = null;
  }

  async initialize() {
    try {
      const encrypted = await fs.readFile(this.tokenPath);
      if (!this.safeStorage.isEncryptionAvailable()) return;
      this.tokens = JSON.parse(this.safeStorage.decryptString(encrypted));
      await this.getAccessToken();
      await this.loadProfile();
    } catch {
      this.tokens = null;
      this.profile = null;
    }
  }

  status() {
    return { signedIn: Boolean(this.tokens), profile: this.profile };
  }

  async signIn() {
    const config = this.getConfig();
    const verifier = base64Url(crypto.randomBytes(48));
    const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
    const state = base64Url(crypto.randomBytes(24));

    const result = await new Promise((resolve, reject) => {
      const server = http.createServer(async (request, response) => {
        try {
          const callback = new URL(request.url, "http://127.0.0.1");
          if (callback.pathname !== "/oauth/callback") {
            response.writeHead(404).end();
            return;
          }
          if (callback.searchParams.get("state") !== state) {
            throw new Error("The sign-in response could not be verified.");
          }
          const oauthError = callback.searchParams.get("error");
          if (oauthError) throw new Error(`Google sign-in was not completed: ${oauthError}`);
          const code = callback.searchParams.get("code");
          if (!code) throw new Error("Google did not return an authorization code.");

          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end("<!doctype html><title>Google Drive Utils</title><style>body{background:#080808;color:#fff;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0}</style><p>Signed in. You can close this tab and return to Google Drive Utils.</p>");
          resolve({ code, redirectUri: `http://127.0.0.1:${server.address().port}/oauth/callback` });
        } catch (error) {
          response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          response.end(error.message);
          reject(error);
        } finally {
          server.close();
        }
      });

      server.on("error", reject);
      server.listen(0, "127.0.0.1", async () => {
        const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
        const params = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: SCOPES.join(" "),
          access_type: "offline",
          prompt: "consent",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
        });
        try {
          await this.shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
        } catch (error) {
          server.close();
          reject(error);
        }
      });

      setTimeout(() => {
        server.close();
        reject(new Error("Google sign-in timed out. Please try again."));
      }, 5 * 60 * 1000).unref();
    });

    const body = new URLSearchParams({
      client_id: config.clientId,
      code: result.code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: result.redirectUri,
    });
    if (config.clientSecret) body.set("client_secret", config.clientSecret);
    this.tokens = await this.exchangeToken(body);
    this.tokens.expires_at = Date.now() + this.tokens.expires_in * 1000;
    await this.save();
    await this.loadProfile();
    return this.status();
  }

  async exchangeToken(body) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error_description || "Google sign-in failed.");
    return result;
  }

  async getAccessToken() {
    if (!this.tokens) throw new Error("Sign in with Google to continue.");
    if (this.tokens.expires_at > Date.now() + 60_000) return this.tokens.access_token;
    if (!this.tokens.refresh_token) throw new Error("Your Google session expired. Sign in again.");

    const config = this.getConfig();
    const body = new URLSearchParams({
      client_id: config.clientId,
      refresh_token: this.tokens.refresh_token,
      grant_type: "refresh_token",
    });
    if (config.clientSecret) body.set("client_secret", config.clientSecret);
    const refreshed = await this.exchangeToken(body);
    this.tokens = {
      ...this.tokens,
      ...refreshed,
      refresh_token: refreshed.refresh_token || this.tokens.refresh_token,
      expires_at: Date.now() + refreshed.expires_in * 1000,
    };
    await this.save();
    return this.tokens.access_token;
  }

  async loadProfile() {
    const token = await this.getAccessToken();
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const data = await response.json();
    this.profile = { name: data.name || data.email, email: data.email, picture: data.picture };
  }

  async save() {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure token storage is unavailable on this computer.");
    }
    await fs.mkdir(path.dirname(this.tokenPath), { recursive: true });
    await fs.writeFile(
      this.tokenPath,
      this.safeStorage.encryptString(JSON.stringify(this.tokens)),
      { mode: 0o600 }
    );
  }

  async signOut() {
    const token = this.tokens?.refresh_token || this.tokens?.access_token;
    this.tokens = null;
    this.profile = null;
    await fs.rm(this.tokenPath, { force: true });
    if (token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch {
        // Local credentials are already removed; remote revocation can fail offline.
      }
    }
    return this.status();
  }
}

module.exports = { OAuthManager, SCOPES, base64Url };
