import { expect } from "chai";
import request from "supertest";
import { createApp } from "../src/app";
import { CertificateRegistry } from "../src/services/certificateRegistry";

describe("certificate API", () => {
  it("creates and verifies an active certificate", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/certificates")
      .send({
        certificateHash: "sha256:document",
        recipientHash: "sha256:graduate",
        skillName: "Blockchain Development",
        issuer: "institution-wallet",
      })
      .expect(201);

    expect(response.body.status).to.equal("ACTIVE");
    const verification = await request(app)
      .get(`/api/certificates/${response.body.certificate.id}/verify`)
      .expect(200);
    expect(verification.body.valid).to.equal(true);
    expect(verification.body.status).to.equal("ACTIVE");
  });

  it("reports expiration without treating it as revocation", async () => {
    const registry = new CertificateRegistry();
    const certificate = await registry.create({
      certificateHash: "sha256:document",
      recipientHash: "sha256:graduate",
      skillName: "Blockchain Development",
      issuer: "institution-wallet",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(registry.getStatus(certificate)).to.equal("EXPIRED");
    expect(certificate.revokedAt).to.equal(null);
  });

  it("returns revoked status after revocation", async () => {
    const registry = new CertificateRegistry();
    const app = createApp(registry);
    const created = await request(app)
      .post("/api/certificates")
      .send({
        certificateHash: "sha256:document",
        recipientHash: "sha256:graduate",
        skillName: "Blockchain Development",
        issuer: "institution-wallet",
      })
      .expect(201);

    await request(app)
      .post(`/api/certificates/${created.body.certificate.id}/revoke`)
      .expect(200);
    const verification = await request(app)
      .get(`/api/certificates/${created.body.certificate.id}/verify`)
      .expect(200);

    expect(verification.body.valid).to.equal(false);
    expect(verification.body.status).to.equal("REVOKED");
  });
});
