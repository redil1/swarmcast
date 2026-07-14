import { buildMediaUrlContract } from "@swarmcast/config/media-urls";

export async function resolveChannelPlacement({ channelId, controlPlaneUrl, internalToken, fetchFn = fetch }) {
  if (!controlPlaneUrl) return null;

  const response = await fetchFn(`${controlPlaneUrl}/internal/channels/${channelId}/assign`, {
    method: "POST",
    headers: { "x-internal-token": internalToken }
  });

  if (response.status === 503) return { error: "capacity" };
  if (!response.ok) return { error: "placement_failed" };
  return response.json();
}

export function buildMediaTemplates({ channelId, edgeBase, originBase, placement = null }) {
  return buildMediaUrlContract({ channelId, edgeBase, originBase, placement });
}
