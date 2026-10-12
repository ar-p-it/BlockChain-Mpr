/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTRACT_ADDRESS: string;
  readonly VITE_DEMO_ISSUER_ADDRESS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
