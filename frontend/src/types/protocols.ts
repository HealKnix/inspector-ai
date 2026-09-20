import type { VerificationFinding } from "@/pages/verification/types";

export const PROTOCOL_FIXTURE_SOURCE = "synthetic-demo" as const;

export interface ProtocolViolation {
  id: string;
  ordinal: number;
  category: "critical" | "significant";
  section: string;
  parameter: string;
  code: string;
  pdValue: string;
  rdValue: string;
  idValue: string;
  deviation: string;
  inspectorDecision: "Подтверждено";
}

export interface ProtocolRecord {
  id: string;
  objectId: string;
  objectName: string;
  checkedAt: string;
  findings: readonly VerificationFinding[];
  violations: readonly ProtocolViolation[];
  source: typeof PROTOCOL_FIXTURE_SOURCE;
  isSynthetic: true;
  fixtureNotice: string;
}

export interface CreateProtocolInput {
  objectId: string;
  objectName: string;
  checkedAt: string;
  findings: readonly VerificationFinding[];
  violations: readonly ProtocolViolation[];
}

export interface CreateSyntheticProtocolInput extends CreateProtocolInput {
  id: string;
}
