import { createHmac } from "node:crypto";

export function issueTurnCredentials({ urls, sharedSecret, ttlSeconds, subject, nowSeconds }) {
  const expiresAt = nowSeconds + ttlSeconds;
  const username = `${expiresAt}:${subject}`;
  const credential = createHmac("sha1", sharedSecret).update(username).digest("base64");
  return {
    urls: [...urls],
    username,
    credential,
    expiresAt
  };
}
