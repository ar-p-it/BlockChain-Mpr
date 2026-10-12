import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    hardhat: {},
    localhost: {
      url: process.env.RPC_URL ?? "http://127.0.0.1:8545",
    },
  },
};

export default config;
