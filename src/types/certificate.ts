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
}

export interface CreateCertificateInput {
  certificateHash: string;
  recipientHash: string;
  skillName: string;
  issuer: string;
  expiresAt?: string | null;
}
