import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

function readJsonlRecords(recordsFile) {
  if (!existsSync(recordsFile)) throw new Error(`retention records file not found: ${recordsFile}`);
  const text = readFileSync(recordsFile, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`${recordsFile}:${index + 1}: invalid JSONL retention record`);
      }
    });
}

export function createJsonlRetentionStore({ recordsFile, actionLogFile }) {
  const records = readJsonlRecords(recordsFile);

  return {
    async listRetentionRecords({ classId }) {
      return records.filter((record) => record.classId === classId);
    },

    async applyRetentionAction({ record, action, dryRun, now }) {
      if (dryRun) return;
      if (!actionLogFile) throw new Error("RETENTION_ACTION_LOG is required when executing the JSONL retention store");
      mkdirSync(dirname(actionLogFile), { recursive: true });
      appendFileSync(actionLogFile, `${JSON.stringify({
        at: now.toISOString(),
        recordId: record.id ?? null,
        classId: record.classId,
        observedAt: record.observedAt,
        action
      })}\n`);
    }
  };
}
