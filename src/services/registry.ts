import type {
  Certificate,
  CertificateStatus,
  CreateCertificateInput,
} from "../types/certificate";

export interface CertificateRegistryPort {
  create(input: CreateCertificateInput): Promise<Certificate>;
  get(id: string): Promise<Certificate | undefined>;
  revoke(id: string): Promise<Certificate | undefined>;
  getStatus(certificate: Certificate): CertificateStatus;
}
