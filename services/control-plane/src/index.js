import { existsSync, readFileSync } from "node:fs";
import { loadControlPlaneConfig } from "@swarmcast/config/env";
import { createLogger } from "@swarmcast/config/logging";
import { CatalogStore } from "./catalogStore.js";
import { createControlPlaneServer } from "./catalogServer.js";
import { PlacementRegistry, PlacementService } from "./placement.js";

async function loadSqliteCatalogStore(filePath) {
  const { SQLiteCatalogStore } = await import("./sqliteCatalogStore.js");
  return SQLiteCatalogStore.fromDatabaseFile(filePath);
}

async function importSqliteCatalogStore(filePath, catalogText, options) {
  const { SQLiteCatalogStore } = await import("./sqliteCatalogStore.js");
  return SQLiteCatalogStore.fromM3uText(filePath, catalogText, options);
}

export async function loadCatalogStore(runtimeConfig, logger) {
  let catalogText = null;
  let catalogError = null;
  try {
    catalogText = readFileSync(runtimeConfig.m3uPath, "utf8");
  } catch (error) {
    catalogError = error;
  }

  if (catalogText !== null) {
    const store = runtimeConfig.catalogDbPath
      ? await importSqliteCatalogStore(runtimeConfig.catalogDbPath, catalogText, {
        sourcePolicy: runtimeConfig.sourcePolicy
      })
      : CatalogStore.fromM3uText(catalogText, {
        sourcePolicy: runtimeConfig.sourcePolicy
      });

    if (runtimeConfig.catalogDbPath) {
      logger.info("catalog_database_saved", {
        catalog_db_path: runtimeConfig.catalogDbPath,
        catalog_channels: store.channels.length
      }, "catalog database saved");
    }

    if (runtimeConfig.catalogSnapshotPath) {
      store.saveSnapshot(runtimeConfig.catalogSnapshotPath);
      logger.info("catalog_snapshot_saved", {
        catalog_snapshot_path: runtimeConfig.catalogSnapshotPath,
        catalog_channels: store.channels.length
      }, "catalog snapshot saved");
    }
    return store;
  }

  if (runtimeConfig.catalogDbPath && existsSync(runtimeConfig.catalogDbPath)) {
    try {
      const store = await loadSqliteCatalogStore(runtimeConfig.catalogDbPath);
      if (store.channels.length > 0) {
        logger.warn("catalog_database_loaded", {
          catalog_db_path: runtimeConfig.catalogDbPath,
          error_class: "catalog_source_unavailable",
          catalog_channels: store.channels.length
        }, "loading catalog database because m3u source is unavailable");
        return store;
      }
    } catch (error) {
      logger.warn("catalog_database_load_failed", {
        catalog_db_path: runtimeConfig.catalogDbPath,
        error_class: error.name || "Error"
      }, "catalog database fallback failed");
    }
  }

  if (runtimeConfig.catalogSnapshotPath) {
    logger.warn("catalog_snapshot_loaded", {
      catalog_snapshot_path: runtimeConfig.catalogSnapshotPath,
      error_class: "catalog_source_unavailable"
    }, "loading catalog snapshot because m3u source is unavailable");
    return CatalogStore.fromSnapshotFile(runtimeConfig.catalogSnapshotPath);
  }

  throw catalogError;
}

export async function loadPlacementRegistry(runtimeConfig, logger) {
  if (runtimeConfig.placementDbPath) {
    const { SQLitePlacementRegistry } = await import("./sqlitePlacementRegistry.js");
    const registry = await SQLitePlacementRegistry.open(runtimeConfig.placementDbPath);
    logger.info("placement_database_loaded", {
      placement_db_path: runtimeConfig.placementDbPath,
      placements: registry.entries().length
    }, "placement database loaded");
    return registry;
  }
  return new PlacementRegistry({ filePath: runtimeConfig.placementPath || null });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtimeConfig = loadControlPlaneConfig(process.env, { requireSecrets: true });
  const logger = createLogger({ service: "control-plane" });
  const store = await loadCatalogStore(runtimeConfig, logger);
  const registry = await loadPlacementRegistry(runtimeConfig, logger);
  const placementService = new PlacementService({
    nodes: runtimeConfig.ingestNodes,
    registry
  });
  const server = createControlPlaneServer({
    store,
    placementService,
    internalToken: runtimeConfig.internalToken,
    logger
  });
  server.listen(runtimeConfig.port, () => {
    logger.info("service_started", { node_id: "control-plane", port: runtimeConfig.port }, "control-plane listening");
  });
}
