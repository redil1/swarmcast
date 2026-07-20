import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const NGINX_IMAGE = process.env.SWARMCAST_NGINX_SMOKE_IMAGE || "nginx:1.29.8-alpine3.23-slim@sha256:c9366b8c560169b101ca0e5422ed063b20779e6454c2326b9c9704225c9b0c08";

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    ...options
  });
}

function commandExists(name) {
  return run("sh", ["-lc", `command -v ${name}`]).status === 0;
}

function dockerReady() {
  return commandExists("docker") && run("docker", ["info", "--format", "{{.ServerVersion}}"]).status === 0;
}

function imageExists(image) {
  return run("docker", ["image", "inspect", image, "--format", "{{.Id}}"]).status === 0;
}

function ensureCertTree(tempRoot, domains) {
  for (const domain of domains) {
    const dir = path.join(tempRoot, "letsencrypt", "live", domain);
    mkdirSync(dir, { recursive: true });
    const key = path.join(dir, "privkey.pem");
    const cert = path.join(dir, "fullchain.pem");
    const result = run("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-subj", `/CN=${domain}`,
      "-keyout", key,
      "-out", cert,
      "-days", "1"
    ]);
    if (result.status !== 0) {
      throw new Error(`openssl failed for ${domain}\n${result.stderr}`);
    }
  }
}

function dockerNginxTest({ label, configDir, mainConfig, tempRoot, extraHosts = [] }) {
  const image = NGINX_IMAGE;
  if (!imageExists(image)) {
    console.log(`${label}: ${image} image not present; skipping. Run 'docker pull ${image}' to enable this smoke.`);
    return;
  }

  const mainConfigPath = path.isAbsolute(mainConfig) ? mainConfig : path.join(rootDir, mainConfig);
  const configDirPath = path.isAbsolute(configDir) ? configDir : path.join(rootDir, configDir);
  const args = [
    "run", "--rm",
    "--add-host", "tracker:127.0.0.1",
    "--add-host", "auth:127.0.0.1",
    "--add-host", "control-plane:127.0.0.1",
    "--add-host", "auth.example.tv:127.0.0.1",
    "--add-host", "origin.example.tv:127.0.0.1",
    ...extraHosts.flatMap((host) => ["--add-host", `${host}:127.0.0.1`]),
    "-v", `${mainConfigPath}:/etc/nginx/nginx.conf:ro`,
    "-v", `${configDirPath}:/etc/nginx/conf.d:ro`,
    "-v", `${path.join(tempRoot, "letsencrypt")}:/etc/letsencrypt:ro`,
    "-v", `${path.join(tempRoot, "certbot")}:/var/www/certbot:ro`,
    "-v", `${tempRoot}:/var/hls_alias:ro`,
    image,
    "nginx", "-t"
  ];

  const result = run("docker", args);
  if (result.status !== 0) {
    throw new Error(`${label}: nginx -t failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  console.log(`${label}: nginx -t OK`);
}

if (!dockerReady()) {
  console.log("Docker daemon not available; skipping nginx config smoke");
  process.exit(0);
}

if (!commandExists("openssl")) {
  console.log("openssl not available; skipping nginx config smoke");
  process.exit(0);
}

const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-nginx-"));
ensureCertTree(tempRoot, ["origin.example.tv", "tracker.example.tv", "edge.example.tv", "api.example.tv"]);
mkdirSync(path.join(tempRoot, "certbot", ".well-known", "acme-challenge"), { recursive: true });
writeFileSync(path.join(tempRoot, "placeholder"), "ok");

const originConfDir = path.join(tempRoot, "origin-conf");
mkdirSync(originConfDir, { recursive: true });
cpSync(path.join(rootDir, "infra/nginx/swarmcast.conf"), path.join(originConfDir, "swarmcast.conf"));

dockerNginxTest({
  label: "origin nginx",
  configDir: originConfDir,
  mainConfig: "infra/nginx/nginx.conf",
  tempRoot
});

const edgeConfDir = path.join(tempRoot, "edge-conf");
mkdirSync(edgeConfDir, { recursive: true });
cpSync(path.join(rootDir, "infra/edge/nginx-edge.conf"), path.join(edgeConfDir, "edge.conf"));
const edgeMain = path.join(tempRoot, "edge-nginx.conf");
writeFileSync(edgeMain, `
worker_processes auto;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  include /etc/nginx/conf.d/*.conf;
}
`);

const result = run("docker", [
  "run", "--rm",
  "--add-host", "auth.example.tv:127.0.0.1",
  "--add-host", "origin.example.tv:127.0.0.1",
  "--add-host", "n1.origin.example.tv:127.0.0.1",
  "-v", `${edgeMain}:/etc/nginx/nginx.conf:ro`,
  "-v", `${edgeConfDir}:/etc/nginx/conf.d:ro`,
  "-v", `${path.join(tempRoot, "letsencrypt")}:/etc/letsencrypt:ro`,
  "-v", `${path.join(tempRoot, "certbot")}:/var/www/certbot:ro`,
  "--tmpfs", "/dev/shm/edgecache:size=16m",
  NGINX_IMAGE,
  "nginx", "-t"
]);

if (result.status !== 0) {
  throw new Error(`edge nginx: nginx -t failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}
console.log("edge nginx: nginx -t OK");
