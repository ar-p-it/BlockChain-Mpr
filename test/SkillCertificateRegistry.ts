import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const certificateId = ethers.keccak256(ethers.toUtf8Bytes("certificate-1"));
const certificateHash = ethers.keccak256(ethers.toUtf8Bytes("document-1"));
const recipientHash = ethers.keccak256(ethers.toUtf8Bytes("graduate-1"));

async function deployRegistry() {
  const [administrator, institution, other] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("SkillCertificateRegistry");
  const registry = await factory.deploy();
  await registry.waitForDeployment();
  return { registry, administrator, institution, other };
}

describe("SkillCertificateRegistry", () => {
  it("allows an approved institution to issue a certificate", async () => {
    const { registry, administrator, institution } = await deployRegistry();
    await registry
      .connect(administrator)
      .setInstitutionApproval(institution.address, true);

    await expect(
      registry
        .connect(institution)
        .issueCertificate(
          certificateId,
          certificateHash,
          recipientHash,
          "Blockchain Development",
          0,
        ),
    )
      .to.emit(registry, "CertificateIssued")
      .withArgs(certificateId, institution.address);

    const certificate = await registry.getCertificate(certificateId);
    expect(certificate.issuer).to.equal(institution.address);
    expect(certificate.skillName).to.equal("Blockchain Development");
    expect(certificate.status).to.equal(0);
  });

  it("rejects issuance from an unapproved institution", async () => {
    const { registry, other } = await deployRegistry();

    await expect(
      registry
        .connect(other)
        .issueCertificate(
          certificateId,
          certificateHash,
          recipientHash,
          "Blockchain Development",
          0,
        ),
    ).to.be.revertedWith("Institution is not approved");
  });

  it("allows the issuer to revoke a certificate", async () => {
    const { registry, administrator, institution } = await deployRegistry();
    await registry
      .connect(administrator)
      .setInstitutionApproval(institution.address, true);
    await registry
      .connect(institution)
      .issueCertificate(
        certificateId,
        certificateHash,
        recipientHash,
        "Blockchain Development",
        0,
      );

    await expect(registry.connect(institution).revokeCertificate(certificateId))
      .to.emit(registry, "CertificateRevoked")
      .withArgs(certificateId, institution.address);

    const certificate = await registry.getCertificate(certificateId);
    expect(certificate.status).to.equal(1);
  });

  it("stores a future expiration timestamp", async () => {
    const { registry, administrator, institution } = await deployRegistry();
    await registry
      .connect(administrator)
      .setInstitutionApproval(institution.address, true);
    const expiration = (await time.latest()) + 3600;

    await registry
      .connect(institution)
      .issueCertificate(
        certificateId,
        certificateHash,
        recipientHash,
        "Blockchain Development",
        expiration,
      );

    const certificate = await registry.getCertificate(certificateId);
    expect(certificate.expiresAt).to.equal(expiration);
  });
});
