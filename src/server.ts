import "dotenv/config";
import { createApp } from "./app";
import { BlockchainRegistry } from "./services/blockchainRegistry";
import { CertificateRegistry } from "./services/certificateRegistry";

const port = Number(process.env.PORT ?? 3000);
const registry =
  process.env.BLOCKCHAIN_MODE === "chain"
    ? new BlockchainRegistry(
        process.env.RPC_URL ?? "http://127.0.0.1:8545",
        requiredEnvironmentVariable("BACKEND_PRIVATE_KEY"),
        requiredEnvironmentVariable("CONTRACT_ADDRESS"),
      )
    : new CertificateRegistry();
const app = createApp(registry);

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when BLOCKCHAIN_MODE=chain`);
  return value;
}

app.listen(port, () => {
  console.log(
    `Certificate verification API listening on http://localhost:${port}`,
  );
});
