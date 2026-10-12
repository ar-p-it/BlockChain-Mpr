import { createHash, randomUUID } from "node:crypto";
import type {
  Certificate,
  CertificateStatus,
  CreateCertificateInput,
  ActivityEvent,
} from "../types/certificate";
import type { CertificateRegistryPort } from "./registry";

export class CertificateRegistry implements CertificateRegistryPort {
  private readonly certificates = new Map<string, Certificate>();
  private readonly administrator = "memory-admin";
  private readonly approvedInstitutions = new Set<string>();
  private readonly activity: ActivityEvent[] = [];

  async create(input: CreateCertificateInput): Promise<Certificate> {
    if (!(await this.isInstitutionApproved(input.issuer))) {
      throw new Error("Institution is not approved");
    }
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
    this.activity.push({
      type: "CERTIFICATE_ISSUED",
      timestamp: certificate.issuedAt,
      certificateId: id,
      actor: input.issuer,
      transaction: { hash: "memory", blockNumber: 0, contractAddress: "memory" },
    });
    return certificate;
  }

  async get(id: string): Promise<Certificate | undefined> {
    return this.certificates.get(id);
  }

  async revoke(id: string): Promise<Certificate | undefined> {
    const certificate = this.certificates.get(id);
    if (!certificate) return undefined;

    certificate.revokedAt = new Date().toISOString();
    this.activity.push({
      type: "CERTIFICATE_REVOKED",
      timestamp: certificate.revokedAt,
      certificateId: id,
      actor: certificate.issuer,
      transaction: { hash: "memory", blockNumber: 0, contractAddress: "memory" },
    });
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

  async getAdministrator(): Promise<string> {
    return this.administrator;
  }

  async isInstitutionApproved(address: string): Promise<boolean> {
    return this.approvedInstitutions.has(address.toLowerCase());
  }

  async setInstitutionApproval(
    address: string,
    approved: boolean,
  ): Promise<undefined> {
    const normalizedAddress = address.toLowerCase();
    if (approved) this.approvedInstitutions.add(normalizedAddress);
    else this.approvedInstitutions.delete(normalizedAddress);
    this.activity.push({
      type: "INSTITUTION_APPROVAL",
      timestamp: new Date().toISOString(),
      institution: address,
      approved,
      transaction: {
        hash: "memory",
        blockNumber: 0,
        contractAddress: "memory",
      },
    });
    return undefined;
  }

  async listByIssuer(issuer: string): Promise<Certificate[]> {
    return [...this.certificates.values()].filter(
      (certificate) => certificate.issuer.toLowerCase() === issuer.toLowerCase(),
    );
  }

  async listActivity(): Promise<ActivityEvent[]> {
    return [...this.activity].reverse();
  }
}
