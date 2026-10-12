import {
  Contract,
  JsonRpcProvider,
  Wallet,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import type { Certificate, CreateCertificateInput } from "../types/certificate";
import type { CertificateRegistryPort } from "./registry";

const contractAbi = [
  "function issueCertificate(bytes32 certificateId, bytes32 certificateHash, bytes32 recipientHash, string skillName, uint256 expiresAt)",
  "function revokeCertificate(bytes32 certificateId)",
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
  private readonly wallet: Wallet;
  private readonly contract: Contract;

  constructor(rpcUrl: string, privateKey: string, contractAddress: string) {
    const provider = new JsonRpcProvider(rpcUrl);
    this.wallet = new Wallet(privateKey, provider);
    this.contract = new Contract(contractAddress, contractAbi, this.wallet);
  }

  async create(input: CreateCertificateInput): Promise<Certificate> {
    const issuer = await this.wallet.getAddress();
    if (input.issuer.toLowerCase() !== issuer.toLowerCase()) {
      throw new Error("Issuer must match the configured backend wallet");
    }

    const id = keccak256(
      toUtf8Bytes(
        `${input.recipientHash}:${input.skillName}:${
          input.certificateHash
        }:${Date.now()}`,
      ),
    );
    const expiresAt = input.expiresAt
      ? Math.floor(new Date(input.expiresAt).getTime() / 1000)
      : 0;

    const transaction = await this.contract.issueCertificate(
      id,
      toBytes32(input.certificateHash),
      toBytes32(input.recipientHash),
      input.skillName,
      expiresAt,
    );
    await transaction.wait();

    const record = (await this.contract.getCertificate(
      id,
    )) as OnChainCertificate;
    return toCertificate(id, record);
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
    const certificate = await this.get(id);
    if (!certificate) return undefined;

    const normalizedId = id.startsWith("0x") ? id : `0x${id}`;
    const transaction = await this.contract.revokeCertificate(normalizedId);
    await transaction.wait();
    return this.get(id);
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
}
