import { GoogleAuth } from "google-auth-library";

const PLAY_INTEGRITY_SCOPE = "https://www.googleapis.com/auth/playintegrity";

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is missing`);
  return value;
}

export class PlayIntegrityVerifier {
  constructor({
    packageName,
    certificateDigests,
    decodeToken,
    maxTokenAgeSeconds = 120,
    futureSkewSeconds = 5,
    nowMs = Date.now
  }) {
    this.packageName = packageName;
    this.certificateDigests = new Set(certificateDigests);
    this.decodeToken = decodeToken;
    this.maxTokenAgeMs = maxTokenAgeSeconds * 1000;
    this.futureSkewMs = futureSkewSeconds * 1000;
    this.nowMs = nowMs;
  }

  async verify({ integrityToken, expectedRequestHash }) {
    requiredString(integrityToken, "integrity token");
    requiredString(expectedRequestHash, "expected request hash");
    const decoded = await this.decodeToken(integrityToken);
    const payload = decoded?.tokenPayloadExternal || decoded;
    const request = payload?.requestDetails;
    const app = payload?.appIntegrity;
    const account = payload?.accountDetails;
    const device = payload?.deviceIntegrity;

    if (request?.requestPackageName !== this.packageName) throw new Error("integrity package mismatch");
    if (request?.requestHash !== expectedRequestHash) throw new Error("integrity request hash mismatch");
    const timestampMs = Number(request?.timestampMillis);
    const ageMs = this.nowMs() - timestampMs;
    if (!Number.isFinite(timestampMs) || ageMs < -this.futureSkewMs || ageMs > this.maxTokenAgeMs) {
      throw new Error("integrity verdict is stale");
    }
    if (app?.appRecognitionVerdict !== "PLAY_RECOGNIZED") throw new Error("app is not Play recognized");
    if (app?.packageName !== this.packageName) throw new Error("recognized app package mismatch");
    const verdictDigests = Array.isArray(app?.certificateSha256Digest) ? app.certificateSha256Digest : [];
    if (!verdictDigests.some((digest) => this.certificateDigests.has(digest))) {
      throw new Error("app signing certificate mismatch");
    }
    if (account?.appLicensingVerdict !== "LICENSED") throw new Error("app is not Play licensed");
    const deviceVerdicts = Array.isArray(device?.deviceRecognitionVerdict) ? device.deviceRecognitionVerdict : [];
    if (!deviceVerdicts.includes("MEETS_DEVICE_INTEGRITY")) throw new Error("device integrity requirement not met");

    return {
      packageName: this.packageName,
      appRecognitionVerdict: app.appRecognitionVerdict,
      appLicensingVerdict: account.appLicensingVerdict,
      deviceRecognitionVerdict: deviceVerdicts
    };
  }
}

export function createGooglePlayIntegrityVerifier({
  packageName,
  certificateDigests,
  serviceAccountPath,
  maxTokenAgeSeconds
}) {
  const auth = new GoogleAuth({ keyFile: serviceAccountPath, scopes: [PLAY_INTEGRITY_SCOPE] });
  return new PlayIntegrityVerifier({
    packageName,
    certificateDigests,
    maxTokenAgeSeconds,
    decodeToken: async (integrityToken) => {
      const client = await auth.getClient();
      const response = await client.request({
        url: `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
        method: "POST",
        data: { integrity_token: integrityToken }
      });
      return response.data;
    }
  });
}
