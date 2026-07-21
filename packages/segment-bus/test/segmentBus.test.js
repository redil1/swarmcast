import test from "node:test";
import assert from "node:assert/strict";
import {
  SEGMENT_STREAM_NAME,
  SegmentSequenceGate,
  createSegmentPublisher,
  ensureSegmentStream,
  segmentMessageId,
  segmentSubject,
  validateSegmentEnvelope
} from "../src/index.js";

const segment = Object.freeze({
  channelId: "sports.final/eu",
  seq: 42,
  sha256: "a".repeat(64),
  size: 4096,
  k: 24
});

test("production publisher does not require stream management permission", async () => {
  let drained = false;
  let publishedSubject = null;
  const connection = {
    isClosed: () => false,
    isDraining: () => false,
    status: async function* status() {},
    drain: async () => {
      drained = true;
    }
  };
  const publisher = await createSegmentPublisher({
    servers: ["tls://bus.example.tv:4222"],
    user: "ingest",
    password: "ingest-segment-bus-password-0001",
    tlsRequired: true,
    connectTimeoutMs: 1000,
    publishTimeoutMs: 1000,
    manageStream: false
  }, {
    connectFn: async () => connection,
    managerFn: async () => {
      throw new Error("runtime publisher must not request JetStream management");
    },
    clientFn: () => ({
      publish: async (subject) => {
        publishedSubject = subject;
        return { duplicate: false, stream: SEGMENT_STREAM_NAME, seq: 1 };
      }
    })
  });

  await publisher.publish(segment);
  assert.equal(publishedSubject, segmentSubject(segment.channelId));
  assert.equal(publisher.stats.published, 1);
  await publisher.close();
  assert.equal(drained, true);
});

test("segment envelopes normalize immutable metadata", () => {
  assert.deepEqual(validateSegmentEnvelope({ ...segment, sha256: "A".repeat(64) }), segment);
  assert.throws(() => validateSegmentEnvelope({ ...segment, channelId: "" }), /channelId/);
  assert.throws(() => validateSegmentEnvelope({ ...segment, seq: -1 }), /seq/);
  assert.throws(() => validateSegmentEnvelope({ ...segment, seq: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/);
  assert.throws(() => validateSegmentEnvelope({ ...segment, size: 1_073_741_825 }), /size/);
  assert.throws(() => validateSegmentEnvelope({ ...segment, k: 256 }), /k/);
  assert.throws(() => validateSegmentEnvelope({ ...segment, sha256: "bad" }), /sha256/);
});

test("segment subjects safely encode arbitrary channel identifiers", () => {
  const subject = segmentSubject(segment.channelId);
  assert.match(subject, /^swarmcast\.segment\.[A-Za-z0-9_-]+$/);
  assert.equal(subject.includes("sports"), false);
  assert.equal(segmentMessageId(segment), `${subject.split(".").at(-1)}:42:${"a".repeat(64)}`);
});

test("sequence gate rejects duplicate and out-of-order delivery per channel", () => {
  const gate = new SegmentSequenceGate();
  assert.equal(gate.accept(segment).seq, 42);
  assert.equal(gate.accept(segment), null);
  assert.equal(gate.accept({ ...segment, seq: 41 }), null);
  assert.equal(gate.accept({ ...segment, seq: 43 }).seq, 43);
  assert.equal(gate.accept({ ...segment, channelId: "other", seq: 1 }).seq, 1);
  gate.forget(segment.channelId);
  assert.equal(gate.accept({ ...segment, seq: 1 }).seq, 1);
});

test("stream provisioning creates missing streams and reconciles existing streams", async () => {
  const calls = [];
  const config = {
    maxAgeMs: 600_000,
    maxMessagesPerSubject: 120,
    maxBytes: 1_073_741_824,
    replicas: 3
  };
  const existing = {
    streams: {
      info: async (name) => calls.push(["info", name]),
      update: async (name, desired) => {
        calls.push(["update", name, desired]);
        return desired;
      }
    }
  };
  const updated = await ensureSegmentStream(existing, config);
  assert.equal(updated.name, SEGMENT_STREAM_NAME);
  assert.equal(updated.num_replicas, 3);
  assert.equal(updated.allow_direct, true);
  assert.deepEqual(calls.map((call) => call[0]), ["info", "update"]);

  const missing = {
    streams: {
      info: async () => {
        const error = new Error("stream not found");
        error.status = 404;
        throw error;
      },
      add: async (desired) => desired
    }
  };
  const created = await ensureSegmentStream(missing, config);
  assert.equal(created.storage, "file");
  assert.equal(created.max_msgs_per_subject, 120);
});
