import test from "node:test";
import assert from "node:assert/strict";
import { CatalogStore } from "../src/catalogStore.js";
import { controlPlaneStats, formatControlPlaneMetrics } from "../src/metrics.js";
import { PlacementService } from "../src/placement.js";

test("controlPlaneStats summarizes catalog and placements", () => {
  const store = new CatalogStore([
    { id: "1", name: "A", group: "News", logo: "", tvgId: "", sourceUrl: "https://secret/a" }
  ]);
  const placementService = new PlacementService({
    nodes: [{ id: "n1", baseUrl: "https://n1.origin.example.tv" }]
  });
  placementService.assign("1");

  assert.deepEqual(controlPlaneStats({ store, placementService }), {
    catalogChannels: 1,
    catalogGroups: 1,
    placements: 1,
    catalogBackend: "memory",
    placementBackend: "memory"
  });
});

test("formatControlPlaneMetrics emits prometheus text", () => {
  const text = formatControlPlaneMetrics({
    catalogChannels: 20_000,
    catalogGroups: 10,
    placements: 120,
    catalogBackend: "sqlite",
    placementBackend: "sqlite"
  });

  assert.match(text, /swarmcast_control_catalog_channels 20000/);
  assert.match(text, /swarmcast_control_catalog_groups 10/);
  assert.match(text, /swarmcast_control_channel_placements 120/);
  assert.match(text, /swarmcast_control_catalog_backend_info\{backend="sqlite"\} 1/);
  assert.match(text, /swarmcast_control_placement_backend_info\{backend="sqlite"\} 1/);
});
