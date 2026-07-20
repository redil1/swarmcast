export function contributionTier(peer) {
  const downloaded = Math.max(
    (peer.bytesDownP2p || 0) +
    (peer.bytesDownEdge || 0) +
    (peer.bytesDownBootstrapOrigin || 0) +
    (peer.bytesDownRelay || 0),
    1
  );
  const ratio = (peer.bytesUp || 0) / downloaded;
  if (peer.transport === "cell") return "guest";
  if (ratio >= 0.8) return "full";
  if (ratio >= 0.3) return "limited";
  return "throttled";
}

export function isSuperPeer(peer) {
  return peer.transport === "wifi" && peer.uploadEnabled === true && (peer.uplinkKbps || 0) >= 15_000;
}

export function score(peer) {
  const downloaded = (peer.bytesDownP2p || 0) +
    (peer.bytesDownEdge || 0) +
    (peer.bytesDownBootstrapOrigin || 0) +
    (peer.bytesDownRelay || 0);
  const ratio = Math.min((peer.bytesUp || 0) / Math.max(downloaded, 1), 3) / 3;
  const totalTransfers = (peer.transfersOk || 0) + (peer.transfersFail || 0);
  const reliability = totalTransfers === 0 ? 0.5 : (peer.transfersOk || 0) / totalTransfers;
  const capacity = peer.transport === "wifi" && peer.uploadEnabled ? 1 : 0;
  const contributionBonus = contributionTier(peer) === "full" ? 0.15 : 0;
  return 0.45 * ratio + 0.25 * reliability + 0.15 * capacity + contributionBonus;
}

export function electSeeders(swarm, count) {
  if (swarm.peerIndex) return swarm.peerIndex.takeSuper(count);
  const eligible = [...swarm.peers.values()]
    .filter((peer) => peer.transport === "wifi" && peer.uploadEnabled && (peer.superPeer || isSuperPeer(peer)))
    .sort((a, b) => score(b) - score(a));

  if (eligible.length === 0) return [];

  const start = swarm.seedRotation % eligible.length;
  swarm.seedRotation += 1;

  const selected = [];
  for (let i = 0; i < eligible.length && selected.length < count; i += 1) {
    selected.push(eligible[(start + i) % eligible.length]);
  }
  return selected;
}

function shuffled(peers) {
  const copy = [...peers];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function candidatePeers(swarm, forPeer, count = 12, excludedPeerIds = new Set()) {
  if (swarm.peerIndex) {
    const selectedIds = new Set();
    const superTarget = forPeer.transport === "cell" ? count : Math.ceil(count / 3);
    const supers = swarm.peerIndex.takeSuper(superTarget, excludedPeerIds, forPeer.id, selectedIds);
    const normals = swarm.peerIndex.takeNormal(count - supers.length, excludedPeerIds, forPeer.id, selectedIds);
    const extraSupers = swarm.peerIndex.takeSuper(
      count - supers.length - normals.length,
      excludedPeerIds,
      forPeer.id,
      selectedIds
    );
    return [...supers, ...normals, ...extraSupers].map((peer) => ({
      id: peer.id,
      transport: peer.transport,
      superPeer: !!(peer.superPeer || isSuperPeer(peer))
    }));
  }
  const others = [...swarm.peers.values()].filter((peer) =>
    peer.id !== forPeer.id && !excludedPeerIds.has(peer.id)
  );
  const supers = others.filter((peer) => peer.superPeer || isSuperPeer(peer)).sort((a, b) => score(b) - score(a));
  const normals = shuffled(others.filter((peer) => !(peer.superPeer || isSuperPeer(peer))))
    .sort((a, b) => score(b) - score(a));

  const superTarget = forPeer.transport === "cell" ? Math.min(supers.length, count) : Math.min(supers.length, Math.ceil(count / 3));
  const picked = [...supers.slice(0, superTarget)];
  picked.push(...normals.slice(0, count - picked.length));
  if (picked.length < count) {
    picked.push(...supers.slice(superTarget, superTarget + count - picked.length));
  }

  return picked.map((peer) => ({ id: peer.id, transport: peer.transport, superPeer: !!(peer.superPeer || isSuperPeer(peer)) }));
}
