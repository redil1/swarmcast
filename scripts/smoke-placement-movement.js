import { IngestScheduler } from "../services/control-plane/src/scheduler.js";

const CHANNELS = 20_000;
const MOVEMENT_MAX = 0.40;
const LOAD_SKEW_MAX = 1.10;

const beforeNodes = [
  { id: "origin-a", baseUrl: "https://origin-a.example.tv" },
  { id: "origin-b", baseUrl: "https://origin-b.example.tv" }
];
const afterNodes = [
  ...beforeNodes,
  { id: "origin-c", baseUrl: "https://origin-c.example.tv" }
];

const before = new IngestScheduler(beforeNodes, CHANNELS);
const after = new IngestScheduler(afterNodes, CHANNELS);
const afterLoad = new Map(afterNodes.map((node) => [node.id, 0]));
let moved = 0;

for (let i = 0; i < CHANNELS; i += 1) {
  const channelId = `channel-${String(i).padStart(5, "0")}`;
  const oldNode = before.hashRank(channelId)[0];
  const newNode = after.assign(channelId);
  if (!newNode) throw new Error(`failed to assign ${channelId}`);
  if (newNode.id !== oldNode.id) moved += 1;
  afterLoad.set(newNode.id, afterLoad.get(newNode.id) + 1);
}

const movedRatio = moved / CHANNELS;
const loads = [...afterLoad.values()];
const loadSkew = Math.max(...loads) / Math.min(...loads);

if (movedRatio > MOVEMENT_MAX) {
  throw new Error(`placement movement ${movedRatio.toFixed(3)} exceeded ${MOVEMENT_MAX}`);
}
if (loadSkew > LOAD_SKEW_MAX) {
  throw new Error(`placement load skew ${loadSkew.toFixed(3)} exceeded ${LOAD_SKEW_MAX}`);
}

console.log(`placement movement smoke OK: channels=${CHANNELS} moved=${movedRatio.toFixed(3)} loadSkew=${loadSkew.toFixed(3)} loads=${JSON.stringify(Object.fromEntries(afterLoad))}`);
