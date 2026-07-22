import { execFileSync } from "node:child_process";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

function turnEndpoint(url) {
  const match = /^(turns?):([^:/?#]+):(\d+)\?transport=(udp|tcp)$/.exec(url);
  if (!match) throw new Error(`unsupported TURN URL: ${url}`);
  return {
    secure: match[1] === "turns",
    host: match[2],
    port: Number.parseInt(match[3], 10),
    transport: match[4]
  };
}

function runRelay({ image, endpoint, username, credential }) {
  const secureFlags = endpoint.secure
    ? "-t -S -E /etc/ssl/certs/ca-certificates.crt"
    : "";
  execFileSync("docker", [
    "run", "--rm",
    "-e", "TURN_USERNAME",
    "-e", "TURN_CREDENTIAL",
    "--entrypoint", "/bin/sh",
    image,
    "-c",
    `exec turnutils_uclient -u "$TURN_USERNAME" -w "$TURN_CREDENTIAL" ` +
      `-y -c -n 10 -l 4096 ${secureFlags} -p ${endpoint.port} ${endpoint.host}`
  ], {
    env: { ...process.env, TURN_USERNAME: username, TURN_CREDENTIAL: credential },
    stdio: "pipe",
    timeout: 30_000
  });
}

try {
  const apiBase = new URL(optionValue("--api-base"));
  if (apiBase.protocol !== "https:") throw new Error("--api-base must use HTTPS");
  const appApiKey = process.env.APP_API_KEY;
  if (!appApiKey) throw new Error("APP_API_KEY is required in the environment");
  const image = process.env.TURN_CLIENT_IMAGE || "swarmcast-turn:local";
  const response = await fetch(new URL("/token", apiBase), {
    method: "POST",
    headers: { "content-type": "application/json", "x-app-key": appApiKey },
    body: "{}",
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`token endpoint returned HTTP ${response.status}`);
  const session = await response.json();
  const issued = session.iceServers?.find((server) => server.username && server.credential);
  if (!issued) throw new Error("token response did not issue TURN credentials");
  const endpoints = issued.urls.map(turnEndpoint);
  const udp = endpoints.find((endpoint) => !endpoint.secure && endpoint.transport === "udp");
  const tls = endpoints.find((endpoint) => endpoint.secure && endpoint.transport === "tcp");
  if (!udp || !tls) throw new Error("token response must include TURN/UDP and TURN/TLS endpoints");

  runRelay({ image, endpoint: udp, username: issued.username, credential: issued.credential });
  runRelay({ image, endpoint: tls, username: issued.username, credential: issued.credential });
  console.log(JSON.stringify({
    ok: true,
    messageBytesPerTransport: 40_960,
    transports: ["udp", "tls"],
    credentialSource: "live-token-endpoint"
  }));
} catch (error) {
  console.error(`staging TURN relay smoke failed: ${error.message}`);
  process.exitCode = 1;
}
