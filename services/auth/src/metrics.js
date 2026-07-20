function line(name, value, help, type = "gauge") {
  return `# HELP ${name} ${help}
# TYPE ${name} ${type}
${name} ${Number.isFinite(value) ? value : 0}`;
}

export function createAuthMetrics() {
  return {
    tokensIssued: 0,
    turnCredentialsIssued: 0,
    attestationChallengesIssued: 0,
    attestationVerifyOk: 0,
    attestationVerifyFail: 0,
    verifyOk: 0,
    verifyFail: 0
  };
}

export function formatAuthMetrics(metrics) {
  return [
    line("swarmcast_auth_tokens_issued_total", metrics.tokensIssued, "Issued auth tokens", "counter"),
    line("swarmcast_auth_turn_credentials_issued_total", metrics.turnCredentialsIssued, "Issued short-lived TURN credentials", "counter"),
    line("swarmcast_auth_attestation_challenges_issued_total", metrics.attestationChallengesIssued, "Issued app-attestation challenges", "counter"),
    line("swarmcast_auth_attestation_verify_ok_total", metrics.attestationVerifyOk, "Successful app-attestation verifications", "counter"),
    line("swarmcast_auth_attestation_verify_fail_total", metrics.attestationVerifyFail, "Failed app-attestation verifications", "counter"),
    line("swarmcast_auth_verify_ok_total", metrics.verifyOk, "Successful token verifications", "counter"),
    line("swarmcast_auth_verify_fail_total", metrics.verifyFail, "Failed token verifications", "counter")
  ].join("\n") + "\n";
}
