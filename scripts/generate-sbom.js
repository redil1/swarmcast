import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const args = process.argv.slice(2);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readText(file) {
  return readFileSync(path.join(rootDir, file), "utf8");
}

function addComponent(components, component) {
  const key = `${component.ecosystem}:${component.name}:${component.version || ""}:${component.source || ""}`;
  if (components.has(key)) return;
  components.set(key, {
    ...component,
    version: component.version || "unversioned"
  });
}

function npmNameFromPath(packagePath) {
  const parts = packagePath.split("/");
  if (parts[1]?.startsWith("@")) return `${parts[1]}/${parts[2]}`;
  return parts[1];
}

function npmPurl(name, version) {
  const encoded = name.startsWith("@")
    ? `%40${name.slice(1).replace("/", "/")}`
    : name;
  return `pkg:npm/${encoded}@${version}`;
}

function mavenPurl(coordinate, version) {
  const [group, artifact] = coordinate.split(":");
  if (!group || !artifact || !version || version === "managed") return null;
  return `pkg:maven/${group}/${artifact}@${version}`;
}

function collectNpm(components) {
  const lock = JSON.parse(readText("package-lock.json"));
  for (const [packagePath, info] of Object.entries(lock.packages || {})) {
    if (packagePath === "") continue;
    if (!info.name && !packagePath.startsWith("node_modules/")) continue;
    const name = info.name || npmNameFromPath(packagePath);
    if (!name || !info.version) continue;
    addComponent(components, {
      type: info.link ? "workspace" : "library",
      ecosystem: "npm",
      name,
      version: info.version,
      license: info.license || "unknown",
      source: packagePath,
      ...(info.resolved ? { resolved: info.resolved } : {}),
      ...(info.integrity ? { integrity: info.integrity } : {}),
      purl: npmPurl(name, info.version)
    });
  }
}

function collectDockerfiles(components) {
  for (const file of [
    "services/auth/Dockerfile",
    "services/control-plane/Dockerfile",
    "services/ingest/Dockerfile",
    "services/tracker/Dockerfile",
    "services/retention-worker/Dockerfile",
    "infra/nginx/Dockerfile",
    "infra/edge/Dockerfile.nginx",
    "infra/edge/Dockerfile.metrics"
  ]) {
    const text = readText(file);
    for (const match of text.matchAll(/^\s*FROM\s+([^\s]+)(?:\s+AS\s+\S+)?/gim)) {
      addComponent(components, {
        type: "container",
        ecosystem: "oci",
        name: match[1],
        version: imageTag(match[1]),
        source: file
      });
    }
  }
}

function collectComposeImages(components) {
  for (const file of [
    "infra/docker-compose.yml",
    "infra/docker-compose.release.yml",
    "infra/edge/docker-compose.yml"
  ]) {
    const text = readText(file);
    for (const match of text.matchAll(/^\s*image:\s+(.+)$/gm)) {
      const image = match[1].trim().replace(/^["']|["']$/g, "");
      addComponent(components, {
        type: "container",
        ecosystem: "oci",
        name: image,
        version: imageTag(image),
        source: file
      });
    }
  }
}

function imageTag(image) {
  const atDigest = image.split("@sha256:")[1];
  if (atDigest) return `sha256:${atDigest}`;
  const last = image.split("/").pop() || image;
  const colon = last.lastIndexOf(":");
  return colon >= 0 ? last.slice(colon + 1) : "latest";
}

function gradleVariables(text) {
  const vars = new Map();
  for (const match of text.matchAll(/val\s+([A-Za-z0-9_]+)\s*=\s*"([^"]+)"/g)) {
    vars.set(match[1], match[2]);
  }
  return vars;
}

function resolveGradleVersion(version, vars) {
  if (!version) return "managed";
  if (version.startsWith("$")) return vars.get(version.slice(1)) || version;
  return version;
}

function collectAndroid(components) {
  const rootBuild = readText("android/build.gradle.kts");
  for (const match of rootBuild.matchAll(/id\("([^"]+)"\)\s+version\s+"([^"]+)"/g)) {
    addComponent(components, {
      type: "gradle-plugin",
      ecosystem: "gradle",
      name: match[1],
      version: match[2],
      source: "android/build.gradle.kts"
    });
  }

  const appBuild = readText("android/app/build.gradle.kts");
  const vars = gradleVariables(appBuild);
  for (const match of appBuild.matchAll(/(?:implementation|api|runtimeOnly|testImplementation|androidTestImplementation)\((?:platform\()?["']([^"']+)["']\)?\)/g)) {
    const [group, artifact, rawVersion] = match[1].split(":");
    if (!group || !artifact) continue;
    const version = resolveGradleVersion(rawVersion, vars);
    addComponent(components, {
      type: match[0].includes("platform(") ? "bom" : "library",
      ecosystem: "maven",
      name: `${group}:${artifact}`,
      version,
      source: "android/app/build.gradle.kts",
      ...(mavenPurl(`${group}:${artifact}`, version) ? { purl: mavenPurl(`${group}:${artifact}`, version) } : {})
    });
  }
}

function createSbom() {
  const components = new Map();
  collectNpm(components);
  collectDockerfiles(components);
  collectComposeImages(components);
  collectAndroid(components);
  return {
    bomFormat: "SwarmCast-SBOM",
    specVersion: "1.0",
    metadata: {
      project: "swarmcast",
      sourceFiles: [
        "package-lock.json",
        "android/build.gradle.kts",
        "android/app/build.gradle.kts",
        "infra/docker-compose.yml",
        "infra/docker-compose.release.yml",
        "infra/edge/docker-compose.yml",
        "services/*/Dockerfile",
        "infra/nginx/Dockerfile",
        "infra/edge/Dockerfile.nginx",
        "infra/edge/Dockerfile.metrics"
      ]
    },
    components: [...components.values()].sort((a, b) =>
      `${a.ecosystem}:${a.name}:${a.version}`.localeCompare(`${b.ecosystem}:${b.name}:${b.version}`)
    )
  };
}

function assertCoverage(sbom) {
  const ecosystems = new Set(sbom.components.map((component) => component.ecosystem));
  for (const ecosystem of ["npm", "maven", "gradle", "oci"]) {
    if (!ecosystems.has(ecosystem)) throw new Error(`SBOM missing ${ecosystem} components`);
  }

  for (const required of ["jose", "uWebSockets.js", "nginx:1.27", "prom/prometheus:v2.53.0", "androidx.media3:media3-exoplayer", "io.getstream:stream-webrtc-android"]) {
    if (!sbom.components.some((component) => component.name === required || component.name.includes(required))) {
      throw new Error(`SBOM missing required component ${required}`);
    }
  }
}

const sbom = createSbom();
if (args.includes("--check")) {
  assertCoverage(sbom);
  console.log(`SBOM OK: ${sbom.components.length} components across ${new Set(sbom.components.map((component) => component.ecosystem)).size} ecosystems`);
} else {
  const output = `${JSON.stringify(sbom, null, 2)}\n`;
  const outputPath = argValue("--output");
  if (outputPath) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, output);
  } else {
    process.stdout.write(output);
  }
}
