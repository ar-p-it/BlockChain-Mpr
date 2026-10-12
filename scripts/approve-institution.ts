import { ethers } from "hardhat";

async function main() {
  const institution = process.env.INSTITUTION_ADDRESS;
  if (!institution) {
    throw new Error("INSTITUTION_ADDRESS is required");
  }

  const registryAddress = process.env.CONTRACT_ADDRESS;
  if (!registryAddress) {
    throw new Error("CONTRACT_ADDRESS is required");
  }

  const registry = await ethers.getContractAt(
    "SkillCertificateRegistry",
    registryAddress,
  );
  const transaction = await registry.setInstitutionApproval(institution, true);
  await transaction.wait();

  console.log(`Approved institution ${institution}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
