import { Router, type NextFunction, type Request, type Response } from "express";
import { isAddress } from "ethers";
import type { CertificateRegistryPort } from "../services/registry";

export function createAdminRouter(
  registry: CertificateRegistryPort,
  adminApiKey?: string,
): Router {
  const router = Router();
  const requireAdminKey = (request: Request, response: Response, next: NextFunction) => {
    if (adminApiKey && request.header("x-admin-key") !== adminApiKey) {
      response.status(401).json({ error: "Admin authentication required" });
      return;
    }
    next();
  };

  router.get("/", requireAdminKey, async (_request, response) => {
    try {
      response.json({ administrator: await registry.getAdministrator() });
    } catch (error) {
      response.status(502).json({
        error:
          error instanceof Error ? error.message : "Unable to read administrator",
      });
    }
  });

  router.get("/institutions/:address", requireAdminKey, async (request, response) => {
    if (!isAddress(request.params.address)) {
      response.status(400).json({ error: "Invalid institution address" });
      return;
    }

    try {
      response.json({
        address: request.params.address,
        approved: await registry.isInstitutionApproved(request.params.address),
      });
    } catch (error) {
      response.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "Unable to read institution approval",
      });
    }
  });

  router.get("/activity", requireAdminKey, async (_request, response) => {
    try {
      response.json({ activity: await registry.listActivity() });
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : "Unable to load activity",
      });
    }
  });

  router.put("/institutions/:address", requireAdminKey, async (request, response) => {
    if (!isAddress(request.params.address)) {
      response.status(400).json({ error: "Invalid institution address" });
      return;
    }
    if (typeof request.body?.approved !== "boolean") {
      response.status(400).json({ error: "approved must be a boolean" });
      return;
    }

    try {
      const transaction = await registry.setInstitutionApproval(
        request.params.address,
        request.body.approved,
      );
      response.json({
        address: request.params.address,
        approved: await registry.isInstitutionApproved(request.params.address),
        transaction,
      });
    } catch (error) {
      response.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "Unable to update institution approval",
      });
    }
  });

  return router;
}
