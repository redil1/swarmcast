import { segmentBusConfigFromEnv } from "@swarmcast/config/env";
import { provisionSegmentStream } from "@swarmcast/segment-bus";

try {
  const config = segmentBusConfigFromEnv(process.env, { requireEnabled: true });
  const info = await provisionSegmentStream({
    ...config,
    clientName: `swarmcast-segment-stream-provisioner-${process.env.HOSTNAME || "local"}`
  });
  console.log(`Segment metadata stream provisioned: name=${info.config.name} replicas=${info.config.num_replicas}`);
} catch (error) {
  console.error(`Segment metadata stream provisioning failed: ${error.message}`);
  process.exit(1);
}
