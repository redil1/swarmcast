function line(name, value, help, type = "gauge") {
  return `# HELP ${name} ${help}
# TYPE ${name} ${type}
${name} ${Number.isFinite(value) ? value : 0}`;
}

function labelValue(value) {
  return String(value || "unknown").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function infoLine(name, labels, help) {
  const labelText = Object.entries(labels)
    .map(([key, value]) => `${key}="${labelValue(value)}"`)
    .join(",");
  return `# HELP ${name} ${help}
# TYPE ${name} gauge
${name}{${labelText}} 1`;
}

export function controlPlaneStats({ store, placementService = null }) {
  return {
    catalogChannels: store.channels.length,
    catalogGroups: store.groups.length,
    placements: placementService ? placementService.registry.entries().length : 0,
    catalogBackend: store.backend || "unknown",
    placementBackend: placementService ? placementService.registry.backend || "unknown" : "none"
  };
}

export function formatControlPlaneMetrics(stats) {
  return [
    line("swarmcast_control_catalog_channels", stats.catalogChannels, "Channels loaded in the catalog"),
    line("swarmcast_control_catalog_groups", stats.catalogGroups, "Channel groups loaded in the catalog"),
    line("swarmcast_control_channel_placements", stats.placements, "Active channel-to-ingest placements"),
    infoLine("swarmcast_control_catalog_backend_info", { backend: stats.catalogBackend }, "Catalog storage backend in use"),
    infoLine("swarmcast_control_placement_backend_info", { backend: stats.placementBackend }, "Placement registry backend in use")
  ].join("\n") + "\n";
}
