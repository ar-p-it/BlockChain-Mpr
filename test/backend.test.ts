import { expect } from "chai";
import request from "supertest";
import { createApp } from "../src/app";
import { CertificateRegistry } from "../src/services/certificateRegistry";

describe("certificate API", () => {
  it("rejects issuance from an unapproved in-memory institution", async () => {
    const app = createApp(new CertificateRegistry());
    await request(app)
      .post("/api/certificates")
      .send({
        certificateHash: "sha256:document",
        recipientHash: "sha256:graduate",
        skillName: "Blockchain Development",
        issuer: "unapproved-institution",
      })
      .expect(502)
      .expect(({ body }) =>
        expect(body.error).to.equal("Institution is not approved"),
      );
  });

  it("reads and updates institution approval through the admin API", async () => {
    const app = createApp(new CertificateRegistry());
    const address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

    await request(app)
      .get("/api/admin")
      .expect(200)
      .expect(({ body }) => expect(body.administrator).to.equal("memory-admin"));

    await request(app)
      .put(`/api/admin/institutions/${address}`)
      .send({ approved: true })
      .expect(200)
      .expect(({ body }) => expect(body.approved).to.equal(true));

    await request(app)
      .get(`/api/admin/institutions/${address}`)
      .expect(200)
      .expect(({ body }) => expect(body.approved).to.equal(true));

    await request(app)
      .put(`/api/admin/institutions/${address}`)
      .send({ approved: false })
      .expect(200)
      .expect(({ body }) => expect(body.approved).to.equal(false));
  });

  it("does not expose institution approval status without admin authentication", async () => {
    const app = createApp(new CertificateRegistry(), "test-admin-key");
    const address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

    await request(app)
      .get(`/api/admin/institutions/${address}`)
      .expect(401);

    await request(app)
      .get(`/api/admin/institutions/${address}`)
      .set("x-admin-key", "test-admin-key")
      .expect(200);
  });

  it("protects admin mutations when an API key is configured", async () => {
    const app = createApp(new CertificateRegistry(), "test-admin-key");
    const address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

    await request(app)
      .put(`/api/admin/institutions/${address}`)
      .send({ approved: true })
      .expect(401);

    await request(app)
      .put(`/api/admin/institutions/${address}`)
      .set("x-admin-key", "test-admin-key")
      .send({ approved: true })
      .expect(200);
  });

  it("returns administrator activity", async () => {
    const registry = new CertificateRegistry();
    const app = createApp(registry);
    await registry.setInstitutionApproval("institution-wallet", true);

    const response = await request(app).get("/api/admin/activity").expect(200);
    expect(response.body.activity[0].type).to.equal("INSTITUTION_APPROVAL");
  });

  it("creates and verifies an active certificate", async () => {
    const registry = new CertificateRegistry();
    await registry.setInstitutionApproval("institution-wallet", true);
    const app = createApp(registry);
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
    await registry.setInstitutionApproval("institution-wallet", true);
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
    await registry.setInstitutionApproval("institution-wallet", true);
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
