import { Router } from "express";
import { z } from "zod";
import type { CertificateRegistryPort } from "../services/registry";

const createCertificateSchema = z.object({
  certificateHash: z.string().min(1),
  recipientHash: z.string().min(1),
  skillName: z.string().trim().min(1),
  issuer: z.string().trim().min(1),
  expiresAt: z.string().datetime().nullable().optional(),
});

export function createCertificateRouter(
  registry: CertificateRegistryPort,
): Router {
  const router = Router();

  router.get("/", async (request, response) => {
    const issuer = typeof request.query.issuer === "string"
      ? request.query.issuer.trim()
      : "";
    if (!issuer) {
      response.status(400).json({ error: "issuer query parameter is required" });
      return;
    }
    try {
      response.json({ certificates: await registry.listByIssuer(issuer) });
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : "Unable to load history",
      });
    }
  });

  router.post("/", async (request, response) => {
    try {
      const result = createCertificateSchema.safeParse(request.body);
      if (!result.success) {
        response.status(400).json({
          error: "Invalid certificate data",
          details: result.error.flatten(),
        });
        return;
      }

      const certificate = await registry.create(result.data);
      response.status(201).json({
        certificate,
        status: registry.getStatus(certificate),
        verificationUrl: `/api/certificates/${certificate.id}/verify`,
      });
    } catch (error) {
      response.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "Certificate issuance failed",
      });
    }
  });

  router.get("/:id/verify", async (request, response) => {
    try {
      const certificate = await registry.get(request.params.id);
      if (!certificate) {
        response
          .status(404)
          .json({ valid: false, error: "Certificate not found" });
        return;
      }

      const status = registry.getStatus(certificate);
      response.json({
        valid: status === "ACTIVE",
        status,
        certificate,
      });
    } catch (error) {
      response.status(502).json({
        valid: false,
        error:
          error instanceof Error
            ? error.message
            : "Certificate verification failed",
      });
    }
  });

  router.post("/:id/revoke", async (request, response) => {
    try {
      const certificate = await registry.revoke(request.params.id);
      if (!certificate) {
        response.status(404).json({ error: "Certificate not found" });
        return;
      }

      response.json({ certificate, status: registry.getStatus(certificate) });
    } catch (error) {
      response.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "Certificate revocation failed",
      });
    }
  });

  return router;
}
