import {
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  jetstream,
  jetstreamManager
} from "@nats-io/jetstream";
import { connect, nanos } from "@nats-io/transport-node";

export const SEGMENT_STREAM_NAME = "SWARMCAST_SEGMENTS";
export const SEGMENT_SUBJECT_PREFIX = "swarmcast.segment";

const SHA256_HEX = /^[a-f0-9]{64}$/i;

function integerField(value, name, { min, max = Number.MAX_SAFE_INTEGER }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a safe integer between ${min} and ${max}`);
  }
  return parsed;
}

export function validateSegmentEnvelope(input) {
  if (!input || typeof input !== "object") throw new Error("segment must be an object");
  const channelId = String(input.channelId || "").trim();
  if (!channelId || Buffer.byteLength(channelId) > 256) throw new Error("channelId must be 1-256 bytes");
  const seq = integerField(input.seq, "seq", { min: 0 });
  const size = integerField(input.size, "size", { min: 1, max: 1_073_741_824 });
  const k = integerField(input.k, "k", { min: 1, max: 255 });
  const sha256 = String(input.sha256 || "").trim().toLowerCase();
  if (!SHA256_HEX.test(sha256)) throw new Error("sha256 must be a 64 character hex digest");
  return { channelId, seq, sha256, size, k };
}

export function segmentSubject(channelId) {
  const normalized = String(channelId || "").trim();
  if (!normalized || Buffer.byteLength(normalized) > 256) throw new Error("channelId must be 1-256 bytes");
  return `${SEGMENT_SUBJECT_PREFIX}.${Buffer.from(normalized).toString("base64url")}`;
}

export function segmentMessageId(segment) {
  const validated = validateSegmentEnvelope(segment);
  return `${Buffer.from(validated.channelId).toString("base64url")}:${validated.seq}:${validated.sha256}`;
}

function connectionOptions(config, name) {
  return {
    servers: config.servers,
    user: config.user,
    pass: config.password,
    name,
    timeout: config.connectTimeoutMs,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 1_000,
    reconnectJitter: 250,
    reconnectJitterTLS: 250,
    tls: config.tlsRequired ? {} : null
  };
}

function streamConfig(config) {
  return {
    name: config.streamName || SEGMENT_STREAM_NAME,
    description: "Durable SwarmCast HLS segment metadata",
    subjects: [`${SEGMENT_SUBJECT_PREFIX}.>`],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    discard: DiscardPolicy.Old,
    max_age: nanos(config.maxAgeMs),
    max_msgs_per_subject: config.maxMessagesPerSubject,
    max_bytes: config.maxBytes,
    max_msg_size: 4096,
    duplicate_window: nanos(Math.min(config.maxAgeMs, 120_000)),
    num_replicas: config.replicas,
    allow_direct: true
  };
}

function resourceMissing(error) {
  return error?.api_error?.code === 404 ||
    error?.api_error?.err_code === 10059 ||
    error?.status === 404 ||
    /(?:stream|message) not found/i.test(String(error?.message || ""));
}

export async function ensureSegmentStream(manager, config) {
  const desired = streamConfig(config);
  try {
    await manager.streams.info(desired.name);
    return await manager.streams.update(desired.name, desired);
  } catch (error) {
    if (!resourceMissing(error)) throw error;
    return manager.streams.add(desired);
  }
}

export async function provisionSegmentStream(config, {
  connectFn = connect,
  managerFn = jetstreamManager
} = {}) {
  const nc = await connectFn(connectionOptions(config, config.clientName || "swarmcast-segment-stream-provisioner"));
  try {
    const manager = await managerFn(nc);
    return await ensureSegmentStream(manager, config);
  } finally {
    if (!nc.isClosed() && !nc.isDraining()) await nc.drain();
  }
}

export async function createSegmentPublisher(config, {
  connectFn = connect,
  managerFn = jetstreamManager,
  clientFn = jetstream
} = {}) {
  const nc = await connectFn(connectionOptions(config, config.clientName || "swarmcast-ingest-segment-publisher"));
  try {
    if (config.manageStream !== false) {
      const manager = await managerFn(nc);
      await ensureSegmentStream(manager, config);
    }
    const client = clientFn(nc);
    const stats = { published: 0, duplicates: 0, failures: 0, reconnects: 0 };
    let connected = true;
    const statusTask = (async () => {
      for await (const status of nc.status()) {
        if (status.type === "disconnect" || status.type === "error") connected = false;
        if (status.type === "reconnect") {
          connected = true;
          stats.reconnects += 1;
        }
      }
    })().catch(() => {
      connected = false;
      stats.failures += 1;
    });
    return {
      stats,
      isHealthy: () => connected && !nc.isClosed() && !nc.isDraining(),
      async publish(input) {
        const segment = validateSegmentEnvelope(input);
        try {
          const ack = await client.publish(
            segmentSubject(segment.channelId),
            new TextEncoder().encode(JSON.stringify(segment)),
            { msgID: segmentMessageId(segment), timeout: config.publishTimeoutMs }
          );
          if (ack.duplicate) stats.duplicates += 1;
          else stats.published += 1;
          return { segment, duplicate: !!ack.duplicate, stream: ack.stream, seq: ack.seq };
        } catch (error) {
          stats.failures += 1;
          throw error;
        }
      },
      async close() {
        connected = false;
        if (!nc.isClosed() && !nc.isDraining()) await nc.drain();
        await statusTask;
      }
    };
  } catch (error) {
    if (!nc.isClosed()) await nc.close();
    throw error;
  }
}

export class SegmentSequenceGate {
  constructor() {
    this.lastByChannel = new Map();
  }

  accept(input) {
    const segment = validateSegmentEnvelope(input);
    const previous = this.lastByChannel.get(segment.channelId);
    if (previous !== undefined && segment.seq <= previous) return null;
    this.lastByChannel.set(segment.channelId, segment.seq);
    return segment;
  }

  forget(channelId) {
    this.lastByChannel.delete(channelId);
  }
}

export async function createSegmentSubscriber(config, {
  connectFn = connect,
  onSegment,
  onError = () => {}
} = {}) {
  if (typeof onSegment !== "function") throw new Error("onSegment callback is required");
  const nc = await connectFn(connectionOptions(config, config.clientName || "swarmcast-tracker-segment-subscriber"));
  try {
    const client = jetstream(nc);
    const stream = await client.streams.get(config.streamName || SEGMENT_STREAM_NAME);
    const channels = new Map();
    const gate = new SegmentSequenceGate();
    const stats = { received: 0, replayed: 0, duplicates: 0, failures: 0, reconnects: 0 };
    let connected = true;

    async function deliver(data, replayed) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(data));
        const segment = gate.accept(parsed);
        if (!segment) {
          stats.duplicates += 1;
          return;
        }
        if (replayed) stats.replayed += 1;
        else stats.received += 1;
        await onSegment(segment, { replayed });
      } catch (error) {
        stats.failures += 1;
        onError(error);
      }
    }

    async function replayLatest(entry) {
      try {
        const message = await stream.getMessage({ last_by_subj: entry.subject });
        if (message) await deliver(message.data, true);
      } catch (error) {
        if (!resourceMissing(error)) {
          stats.failures += 1;
          onError(error);
        }
      }
    }

    async function consume(entry) {
      try {
        for await (const message of entry.subscription) await deliver(message.data, false);
      } catch (error) {
        if (!nc.isClosed() && !nc.isDraining()) {
          stats.failures += 1;
          onError(error);
        }
      }
    }

    const statusTask = (async () => {
      for await (const status of nc.status()) {
        if (status.type === "disconnect" || status.type === "error") {
          connected = false;
          continue;
        }
        if (status.type !== "reconnect") continue;
        connected = true;
        stats.reconnects += 1;
        await Promise.all([...channels.values()].map(replayLatest));
      }
    })().catch((error) => {
      connected = false;
      stats.failures += 1;
      onError(error);
    });

    return {
      stats,
      isHealthy: () => connected && !nc.isClosed() && !nc.isDraining(),
      async subscribeChannel(channelId) {
        const normalized = validateSegmentEnvelope({
          channelId,
          seq: 0,
          sha256: "0".repeat(64),
          size: 1,
          k: 1
        }).channelId;
        if (channels.has(normalized)) return false;
        const subject = segmentSubject(normalized);
        const entry = { channelId: normalized, subject, subscription: nc.subscribe(subject), task: null };
        channels.set(normalized, entry);
        entry.task = consume(entry);
        await replayLatest(entry);
        return true;
      },
      unsubscribeChannel(channelId) {
        const normalized = String(channelId || "").trim();
        const entry = channels.get(normalized);
        if (!entry) return false;
        channels.delete(normalized);
        entry.subscription.unsubscribe();
        gate.forget(normalized);
        return true;
      },
      activeChannels: () => channels.size,
      async close() {
        connected = false;
        for (const entry of channels.values()) entry.subscription.unsubscribe();
        channels.clear();
        if (!nc.isClosed() && !nc.isDraining()) await nc.drain();
        await statusTask;
      }
    };
  } catch (error) {
    if (!nc.isClosed()) await nc.close();
    throw error;
  }
}
