import type {
  Certificate,
  CertificateStatus,
  CreateCertificateInput,
  TransactionInfo,
  ActivityEvent,
} from "../types/certificate";

export interface CertificateRegistryPort {
  create(input: CreateCertificateInput): Promise<Certificate>;
  get(id: string): Promise<Certificate | undefined>;
  revoke(id: string): Promise<Certificate | undefined>;
  getStatus(certificate: Certificate): CertificateStatus;
  getAdministrator(): Promise<string>;
  isInstitutionApproved(address: string): Promise<boolean>;
  setInstitutionApproval(
    address: string,
    approved: boolean,
  ): Promise<TransactionInfo | undefined>;
  listByIssuer(issuer: string): Promise<Certificate[]>;
  listActivity(): Promise<ActivityEvent[]>;
}
