import {
  Contract,
  JsonRpcProvider,
  Wallet,
  NonceManager,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import type {
  Certificate,
  CreateCertificateInput,
  TransactionInfo,
  ActivityEvent,
} from "../types/certificate";
import type { CertificateRegistryPort } from "./registry";

const contractAbi = [
  "function issueCertificate(bytes32 certificateId, bytes32 certificateHash, bytes32 recipientHash, string skillName, uint256 expiresAt)",
  "function revokeCertificate(bytes32 certificateId)",
  "function administrator() view returns (address)",
  "function approvedInstitutions(address institution) view returns (bool)",
  "function setInstitutionApproval(address institution, bool approved)",
  "event CertificateIssued(bytes32 indexed certificateId, address indexed issuer)",
  "event CertificateRevoked(bytes32 indexed certificateId, address indexed issuer)",
  "event InstitutionApprovalUpdated(address indexed institution, bool approved)",
  "function getCertificate(bytes32 certificateId) view returns (tuple(bytes32 certificateHash, bytes32 recipientHash, string skillName, address issuer, uint256 issuedAt, uint256 expiresAt, uint8 status))",
];

interface OnChainCertificate {
  certificateHash: string;
  recipientHash: string;
  skillName: string;
  issuer: string;
  issuedAt: bigint;
  expiresAt: bigint;
  status: bigint;
}

function toBytes32(value: string): string {
  return /^0x[0-9a-fA-F]{64}$/.test(value)
    ? value
    : keccak256(toUtf8Bytes(value));
}

function toCertificate(id: string, record: OnChainCertificate): Certificate {
  return {
    id: id.replace(/^0x/, ""),
    certificateHash: record.certificateHash,
    recipientHash: record.recipientHash,
    skillName: record.skillName,
    issuer: record.issuer,
    issuedAt: new Date(Number(record.issuedAt) * 1000).toISOString(),
    expiresAt:
      record.expiresAt === 0n
        ? null
        : new Date(Number(record.expiresAt) * 1000).toISOString(),
    revokedAt: record.status === 1n ? new Date().toISOString() : null,
  };
}

export class BlockchainRegistry implements CertificateRegistryPort {
  private readonly wallet: NonceManager;
  private readonly contract: Contract;

  constructor(rpcUrl: string, privateKey: string, contractAddress: string) {
    const provider = new JsonRpcProvider(rpcUrl);
    this.wallet = new NonceManager(new Wallet(privateKey, provider));
    this.contract = new Contract(contractAddress, contractAbi, this.wallet);
  }

  async create(input: CreateCertificateInput): Promise<Certificate> {
    void input;
    throw new Error(
      "Backend issuance is disabled in blockchain mode. Connect an approved institution wallet.",
    );
  }

  async get(id: string): Promise<Certificate | undefined> {
    try {
      const normalizedId = id.startsWith("0x") ? id : `0x${id}`;
      const record = (await this.contract.getCertificate(
        normalizedId,
      )) as OnChainCertificate;
      return toCertificate(normalizedId, record);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Certificate does not exist")
      ) {
        return undefined;
      }
      throw error;
    }
  }

  async revoke(id: string): Promise<Certificate | undefined> {
    void id;
    throw new Error(
      "Backend revocation is disabled in blockchain mode. Connect the issuing institution wallet.",
    );
  }

  getStatus(certificate: Certificate) {
    if (certificate.revokedAt) return "REVOKED" as const;
    if (
      certificate.expiresAt &&
      new Date(certificate.expiresAt) <= new Date()
    ) {
      return "EXPIRED" as const;
    }
    return "ACTIVE" as const;
  }

  async getAdministrator(): Promise<string> {
    return this.contract.administrator();
  }

  async isInstitutionApproved(address: string): Promise<boolean> {
    return this.contract.approvedInstitutions(address);
  }

  async setInstitutionApproval(
    address: string,
    approved: boolean,
  ): Promise<TransactionInfo> {
    const transaction = await this.contract.setInstitutionApproval(
      address,
      approved,
    );
    await transaction.wait();
    return this.transactionInfo(transaction);
  }

  async listByIssuer(issuer: string): Promise<Certificate[]> {
    const events = await this.contract.queryFilter(
      this.contract.filters.CertificateIssued(null, issuer),
    );
    const certificates: Certificate[] = [];
    for (const event of events) {
      if (!("args" in event)) continue;
      const certificateId = event.args[0] as string;
      const certificate = await this.get(certificateId);
      if (certificate) certificates.push(certificate);
    }
    return certificates;
  }

  async listActivity(): Promise<ActivityEvent[]> {
    const events = [
      ...(await this.contract.queryFilter(
        this.contract.filters.InstitutionApprovalUpdated(),
      )).map((event) => ({ event, type: "INSTITUTION_APPROVAL" as const })),
      ...(await this.contract.queryFilter(this.contract.filters.CertificateIssued()))
        .map((event) => ({ event, type: "CERTIFICATE_ISSUED" as const })),
      ...(await this.contract.queryFilter(this.contract.filters.CertificateRevoked()))
        .map((event) => ({ event, type: "CERTIFICATE_REVOKED" as const })),
    ];
    const activity = await Promise.all(
      events.map(async ({ event, type }): Promise<ActivityEvent> => {
        if (!("args" in event)) {
          throw new Error("Unexpected contract event format");
        }
        const args = event.args as unknown[];
        const block = await event.getBlock();
        const transaction = {
          hash: event.transactionHash,
          blockNumber: event.blockNumber,
          contractAddress: await this.contract.getAddress(),
        };
        if (type === "INSTITUTION_APPROVAL") {
          return {
            type: "INSTITUTION_APPROVAL",
            timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
            institution: args[0] as string,
            approved: args[1] as boolean,
            transaction,
          };
        }
        return {
          type,
          timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
          certificateId: (args[0] as string).replace(/^0x/, ""),
          actor: args[1] as string,
          transaction,
        };
      }),
    );
    return activity.sort(
      (left, right) =>
        right.transaction.blockNumber - left.transaction.blockNumber,
    );
  }

  private async transactionInfo(transaction: {
    hash: string;
    wait: () => Promise<{ blockNumber: number }>;
  }): Promise<TransactionInfo> {
    const receipt = await transaction.wait();
    return {
      hash: transaction.hash,
      blockNumber: receipt.blockNumber,
      contractAddress: await this.contract.getAddress(),
    };
  }
}
