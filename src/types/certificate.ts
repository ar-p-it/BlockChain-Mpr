export type CertificateStatus = "ACTIVE" | "REVOKED" | "EXPIRED";

export interface Certificate {
  id: string;
  certificateHash: string;
  recipientHash: string;
  skillName: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  transaction?: TransactionInfo;
}

export interface TransactionInfo {
  hash: string;
  blockNumber: number;
  contractAddress: string;
}

export type ActivityType =
  | "INSTITUTION_APPROVAL"
  | "CERTIFICATE_ISSUED"
  | "CERTIFICATE_REVOKED";

export interface ActivityEvent {
  type: ActivityType;
  timestamp: string;
  transaction: TransactionInfo;
  institution?: string;
  approved?: boolean;
  certificateId?: string;
  actor?: string;
}

export interface CreateCertificateInput {
  certificateHash: string;
  recipientHash: string;
  skillName: string;
  issuer: string;
  expiresAt?: string | null;
}
