import { FormEvent, useState } from "react";
import {
  BrowserProvider,
  Contract,
  keccak256,
  toUtf8Bytes,
} from "ethers";

declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;
    };
  }
}

const registryAbi = [
  "function issueCertificate(bytes32 certificateId, bytes32 certificateHash, bytes32 recipientHash, string skillName, uint256 expiresAt)",
];

type Status = "ACTIVE" | "REVOKED" | "EXPIRED";

type Certificate = {
  id: string;
  certificateHash: string;
  recipientHash: string;
  skillName: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

type Verification = {
  valid: boolean;
  status: Status;
  certificate: Certificate;
};

const emptyIssueForm = {
  certificateHash: "",
  recipientHash: "",
  skillName: "",
  issuer: "",
  expiresAt: "",
};

function toBytes32(value: string): string {
  return /^0x[0-9a-fA-F]{64}$/.test(value)
    ? value
    : keccak256(toUtf8Bytes(value));
}

function App() {
  const [view, setView] = useState<"verify" | "issue">("verify");
  const [certificateId, setCertificateId] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [issueForm, setIssueForm] = useState(emptyIssueForm);
  const [issuedCertificate, setIssuedCertificate] =
    useState<Certificate | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");

  async function connectWallet(): Promise<string> {
    if (!window.ethereum) {
      throw new Error("MetaMask is required to issue certificates.");
    }

    const provider = new BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    setWalletAddress(address);
    setIssueForm((current) => ({ ...current, issuer: address }));
    return address;
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!certificateId.trim()) return;
    setLoading(true);
    setMessage("");
    setVerification(null);

    try {
      const response = await fetch(
        `/api/certificates/${certificateId.trim()}/verify`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Certificate not found");
      setVerification(data);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Verification failed",
      );
    } finally {
      setLoading(false);
    }
  }

  async function issue(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setIssuedCertificate(null);

    try {
      if (!walletAddress) {
        const issuer = import.meta.env.VITE_DEMO_ISSUER_ADDRESS;
        if (!issuer) {
          throw new Error("VITE_DEMO_ISSUER_ADDRESS is not configured.");
        }
        const response = await fetch("/api/certificates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...issueForm,
            issuer,
            expiresAt: issueForm.expiresAt
              ? new Date(issueForm.expiresAt).toISOString()
              : null,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Issuance failed");
        setIssuedCertificate(data.certificate);
        setIssueForm(emptyIssueForm);
        setMessage("Certificate issued in local demo mode.");
        return;
      }

      const address = walletAddress;
      const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
      if (!contractAddress) {
        throw new Error("VITE_CONTRACT_ADDRESS is not configured.");
      }

      const provider = new BrowserProvider(window.ethereum!);
      const signer = await provider.getSigner();
      const contract = new Contract(contractAddress, registryAbi, signer);
      const certificateId = keccak256(
        toUtf8Bytes(
          `${issueForm.recipientHash}:${issueForm.skillName}:${
            issueForm.certificateHash
          }:${Date.now()}`,
        ),
      );
      const certificateHash = toBytes32(issueForm.certificateHash);
      const recipientHash = toBytes32(issueForm.recipientHash);
      const expiresAt = issueForm.expiresAt
        ? Math.floor(new Date(issueForm.expiresAt).getTime() / 1000)
        : 0;

      const transaction = await contract.issueCertificate(
        certificateId,
        certificateHash,
        recipientHash,
        issueForm.skillName,
        expiresAt,
      );
      await transaction.wait();

      const response = await fetch(
        `/api/certificates/${certificateId.slice(2)}/verify`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Verification failed");
      setIssuedCertificate(data.certificate);
      setIssueForm(emptyIssueForm);
      setMessage(`Certificate issued by ${address}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Issuance failed");
    } finally {
      setLoading(false);
    }
  }

  async function revoke() {
    if (!issuedCertificate) return;
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/certificates/${issuedCertificate.id}/revoke`,
        {
          method: "POST",
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Revocation failed");
      setIssuedCertificate(data.certificate);
      setMessage("Certificate revoked successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Revocation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">P</span>
          <span>proofmark</span>
        </div>
        <span className="network">
          <span className="network-dot" /> registry online
        </span>
      </header>

      <section className="hero">
        <p className="eyebrow">Credential integrity, made visible</p>
        <h1>
          Proof that travels
          <br />
          <em>with the achievement.</em>
        </h1>
        <p className="intro">
          Issue trusted skill certificates and let employers verify them against
          an immutable registry.
        </p>
      </section>

      <section className="workspace">
        <nav className="tabs" aria-label="Certificate actions">
          <button
            className={view === "verify" ? "tab active" : "tab"}
            onClick={() => setView("verify")}
          >
            Verify a certificate
          </button>
          <button
            className={view === "issue" ? "tab active" : "tab"}
            onClick={() => setView("issue")}
          >
            Institution portal
          </button>
        </nav>

        {view === "verify" ? (
          <div className="panel verify-panel">
            <div className="panel-heading">
              <p className="section-number">01 / PUBLIC LOOKUP</p>
              <h2>Is this credential genuine?</h2>
              <p>
                Enter the certificate ID supplied by the graduate. We will check
                its issuer, status, and validity period on the registry.
              </p>
            </div>
            <form onSubmit={verify} className="inline-form">
              <label htmlFor="certificate-id">Certificate ID</label>
              <div className="input-row">
                <input
                  id="certificate-id"
                  value={certificateId}
                  onChange={(event) => setCertificateId(event.target.value)}
                  placeholder="Paste certificate ID"
                />
                <button className="primary-button" disabled={loading}>
                  {loading ? "Checking..." : "Verify"}
                </button>
              </div>
            </form>
            {message && <p className="message error">{message}</p>}
            {verification && <VerificationCard result={verification} />}
          </div>
        ) : (
          <div className="panel issue-panel">
            <div className="panel-heading">
              <p className="section-number">02 / INSTITUTION PORTAL</p>
              <h2>Issue a new credential.</h2>
              <p>
                Create a certificate record. MetaMask can sign it directly; if
                MetaMask is unavailable, local demo mode uses the backend wallet.
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void connectWallet().catch((error) =>
                setMessage(
                  error instanceof Error ? error.message : "Wallet connection failed",
                ),
              )}
            >
              {walletAddress
                ? `Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                : "Connect MetaMask"}
            </button>
            <form onSubmit={issue} className="issue-form">
              <label>
                Skill or course name
                <input
                  required
                  value={issueForm.skillName}
                  onChange={(event) =>
                    setIssueForm({
                      ...issueForm,
                      skillName: event.target.value,
                    })
                  }
                  placeholder="e.g. Blockchain Development"
                />
              </label>
              <label>
                Graduate identifier hash
                <input
                  required
                  value={issueForm.recipientHash}
                  onChange={(event) =>
                    setIssueForm({
                      ...issueForm,
                      recipientHash: event.target.value,
                    })
                  }
                  placeholder="sha256:..."
                />
              </label>
              <label>
                Certificate document hash
                <input
                  required
                  value={issueForm.certificateHash}
                  onChange={(event) =>
                    setIssueForm({
                      ...issueForm,
                      certificateHash: event.target.value,
                    })
                  }
                  placeholder="sha256:..."
                />
              </label>
              <label>
                Issuer wallet
                <input
                  required
                  readOnly
                  value={
                    issueForm.issuer ||
                    import.meta.env.VITE_DEMO_ISSUER_ADDRESS ||
                    ""
                  }
                  placeholder="MetaMask or local demo wallet"
                />
              </label>
              <label>
                Expires on <span className="muted">optional</span>
                <input
                  type="datetime-local"
                  value={issueForm.expiresAt}
                  onChange={(event) =>
                    setIssueForm({
                      ...issueForm,
                      expiresAt: event.target.value,
                    })
                  }
                />
              </label>
              <button className="primary-button full-width" disabled={loading}>
                {loading ? "Issuing..." : "Issue certificate"}
              </button>
            </form>
            {message && <p className="message">{message}</p>}
            {issuedCertificate && (
              <IssuedCard certificate={issuedCertificate} onRevoke={revoke} />
            )}
          </div>
        )}
      </section>

      <footer>
        <span>
          Built for institutions, graduates, and the people hiring them.
        </span>
        <span>v0.1 / blockchain registry</span>
      </footer>
    </main>
  );
}

function VerificationCard({ result }: { result: Verification }) {
  return (
    <article className={`result-card ${result.valid ? "valid" : "invalid"}`}>
      <div className="result-top">
        <span className="status-pill">{result.status}</span>
        <span>
          {result.valid ? "Verified on registry" : "Not currently valid"}
        </span>
      </div>
      <h3>{result.certificate.skillName}</h3>
      <dl>
        <div>
          <dt>Issued by</dt>
          <dd>{result.certificate.issuer}</dd>
        </div>
        <div>
          <dt>Issued</dt>
          <dd>{new Date(result.certificate.issuedAt).toLocaleDateString()}</dd>
        </div>
        <div>
          <dt>Valid until</dt>
          <dd>
            {result.certificate.expiresAt
              ? new Date(result.certificate.expiresAt).toLocaleDateString()
              : "No expiry"}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function IssuedCard({
  certificate,
  onRevoke,
}: {
  certificate: Certificate;
  onRevoke: () => void;
}) {
  return (
    <article className="result-card issued-card">
      <div className="result-top">
        <span className="status-pill">
          {certificate.revokedAt ? "REVOKED" : "CREATED"}
        </span>
        <span>Certificate ID generated</span>
      </div>
      <code>{certificate.id}</code>
      <button
        className="danger-button"
        onClick={onRevoke}
        disabled={Boolean(certificate.revokedAt)}
      >
        Revoke certificate
      </button>
    </article>
  );
}

export default App;
