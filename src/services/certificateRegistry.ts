import { createHash, randomUUID } from "node:crypto";
import type {
  Certificate,
  CertificateStatus,
  CreateCertificateInput,
} from "../types/certificate";
import type { CertificateRegistryPort } from "./registry";

export class CertificateRegistry implements CertificateRegistryPort {
  private readonly certificates = new Map<string, Certificate>();

  async create(input: CreateCertificateInput): Promise<Certificate> {
    const id = createHash("sha256")
      .update(
        `${input.recipientHash}:${input.skillName}:${
          input.certificateHash
        }:${randomUUID()}`,
      )
      .digest("hex");

    const certificate: Certificate = {
      id,
      certificateHash: input.certificateHash,
      recipientHash: input.recipientHash,
      skillName: input.skillName,
      issuer: input.issuer,
      issuedAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
    };

    this.certificates.set(id, certificate);
    return certificate;
  }

  async get(id: string): Promise<Certificate | undefined> {
    return this.certificates.get(id);
  }

  async revoke(id: string): Promise<Certificate | undefined> {
    const certificate = this.certificates.get(id);
    if (!certificate) return undefined;

    certificate.revokedAt = new Date().toISOString();
    return certificate;
  }

  getStatus(certificate: Certificate): CertificateStatus {
    if (certificate.revokedAt) return "REVOKED";
    if (
      certificate.expiresAt &&
      new Date(certificate.expiresAt) <= new Date()
    ) {
      return "EXPIRED";
    }
    return "ACTIVE";
  }

}
