import cors from "cors";
import express from "express";
import { CertificateRegistry } from "./services/certificateRegistry";
import type { CertificateRegistryPort } from "./services/registry";
import { createCertificateRouter } from "./routes/certificates";
import { createAdminRouter } from "./routes/admin";

export function createApp(
  registry: CertificateRegistryPort = new CertificateRegistry(),
  adminApiKey?: string,
) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ service: "skill-certificate-verification", status: "ok" });
  });

  app.use("/api/certificates", createCertificateRouter(registry));
  app.use("/api/admin", createAdminRouter(registry, adminApiKey));

  return app;
}
