import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  BrowserProvider,
  Contract,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import { Html5Qrcode } from "html5-qrcode";
import { QRCodeCanvas } from "qrcode.react";

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
  "function revokeCertificate(bytes32 certificateId)",
  "function administrator() view returns (address)",
  "function approvedInstitutions(address) view returns (bool)",
  "function setInstitutionApproval(address, bool)",
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
  transaction?: TransactionInfo;
};

type TransactionInfo = {
  hash: string;
  blockNumber: number;
  contractAddress: string;
};

type ActivityEvent = {
  type: "INSTITUTION_APPROVAL" | "CERTIFICATE_ISSUED" | "CERTIFICATE_REVOKED";
  timestamp: string;
  institution?: string;
  approved?: boolean;
  certificateId?: string;
  actor?: string;
  transaction: TransactionInfo;
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

function adminRequestInit(): RequestInit {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  return key ? { headers: { "x-admin-key": key } } : {};
}

function App() {
  const [view, setView] = useState<"verify" | "issue" | "admin">("verify");
  const [certificateId, setCertificateId] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [issueForm, setIssueForm] = useState(emptyIssueForm);
  const [issuedCertificate, setIssuedCertificate] =
    useState<Certificate | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [administrator, setAdministrator] = useState("");
  const [institutionAddress, setInstitutionAddress] = useState(
    import.meta.env.VITE_DEMO_ISSUER_ADDRESS || "",
  );
  const [institutionApproved, setInstitutionApproved] = useState<
    boolean | null
  >(null);
  const [adminMessage, setAdminMessage] = useState("");
  const [adminTransaction, setAdminTransaction] = useState<TransactionInfo | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityType, setActivityType] = useState<"ALL" | ActivityEvent["type"]>(
    "ALL",
  );
  const [activitySearch, setActivitySearch] = useState("");
  const [institutionHistory, setInstitutionHistory] = useState<Certificate[]>([]);
  const [institutionStatus, setInstitutionStatus] = useState<boolean | null>(null);

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
    await loadInstitutionHistory(address, address);
    return address;
  }

  async function readInstitutionApproval(address: string): Promise<boolean> {
    if (!window.ethereum) {
      throw new Error("MetaMask is required to check institution access.");
    }
    const provider = new BrowserProvider(window.ethereum);
    const contract = new Contract(
      import.meta.env.VITE_CONTRACT_ADDRESS,
      registryAbi,
      provider,
    );
    return Boolean(await contract.approvedInstitutions(address));
  }

  const verifyCertificate = useCallback(async (id: string) => {
    if (!id.trim()) return;
    setLoading(true);
    setMessage("");
    setVerification(null);

    try {
      const response = await fetch(
        `/api/certificates/${encodeURIComponent(id.trim())}/verify`,
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
  }, []);

  async function verify(event: FormEvent) {
    event.preventDefault();
    await verifyCertificate(certificateId);
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get(
      "certificateId",
    );
    if (id) {
      setCertificateId(id);
      void verifyCertificate(id);
    }
  }, [verifyCertificate]);

  async function issue(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setIssuedCertificate(null);

    try {
      if (!walletAddress) throw new Error("Connect an institution wallet first.");
      if (!(await readInstitutionApproval(walletAddress))) {
        throw new Error("This wallet is not an approved institution.");
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
      await loadInstitutionHistory(address);
      setIssueForm(emptyIssueForm);
      setMessage(`Certificate issued by ${address}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Issuance failed");
    } finally {
      setLoading(false);
    }

  }

  async function loadInstitutionHistory(
    issuer = institutionAddress,
    connectedAddress = walletAddress,
  ) {
    if (!issuer.trim()) return;
    try {
      if (
        !connectedAddress ||
        issuer.toLowerCase() !== connectedAddress.toLowerCase()
      ) {
        return;
      }
      const [approved, historyResponse] = await Promise.all([
        readInstitutionApproval(issuer.trim()),
        fetch(`/api/certificates?issuer=${encodeURIComponent(issuer.trim())}`),
      ]);
      const historyData = await historyResponse.json();
      if (!historyResponse.ok) throw new Error(historyData.error ?? "Unable to load certificate history");
      setInstitutionStatus(approved);
      setInstitutionHistory(historyData.certificates);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load institution data");
    }
  }

  async function revoke() {
    if (!issuedCertificate) return;
    setLoading(true);
    setMessage("");

    try {
      if (!window.ethereum || !walletAddress) {
        throw new Error("Connect the issuing institution wallet first.");
      }
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(
        import.meta.env.VITE_CONTRACT_ADDRESS,
        registryAbi,
        signer,
      );
      const transaction = await contract.revokeCertificate(
        `0x${issuedCertificate.id}`,
      );
      await transaction.wait();
      const response = await fetch(
        `/api/certificates/${issuedCertificate.id}/verify`,
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

  async function loadAdministrator() {
      setAdminMessage("");
      try {
        const response = await fetch("/api/admin", adminRequestInit());
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load admin");
        setAdministrator(data.administrator);
        const activityResponse = await fetch(
          "/api/admin/activity",
          adminRequestInit(),
        );
        const activityData = await activityResponse.json();
        if (!activityResponse.ok) {
          throw new Error(activityData.error ?? "Unable to load activity");
        }
        setActivity(activityData.activity);
      } catch (error) {
        setAdminMessage(
          error instanceof Error ? error.message : "Unable to load admin",
        );
      }
    }

  async function checkInstitution() {
      setAdminMessage("");
      setInstitutionApproved(null);
      try {
        const response = await fetch(
          `/api/admin/institutions/${encodeURIComponent(institutionAddress.trim())}`,
          adminRequestInit(),
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to check institution");
        setInstitutionApproved(data.approved);
        setAdminTransaction(data.transaction ?? null);
      } catch (error) {
        setAdminMessage(
          error instanceof Error ? error.message : "Unable to check institution",
        );
      }
    }

  async function updateInstitution(approved: boolean) {
      setLoading(true);
      setAdminMessage("");
      try {
        if (!window.ethereum) throw new Error("MetaMask is required for admin actions.");
        const provider = new BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const adminWallet = await signer.getAddress();
        if (adminWallet.toLowerCase() !== administrator.toLowerCase()) {
          throw new Error("Connected wallet is not the administrator.");
        }
        const contract = new Contract(
          import.meta.env.VITE_CONTRACT_ADDRESS,
          registryAbi,
          signer,
        );
        const transaction = await contract.setInstitutionApproval(
          institutionAddress.trim(),
          approved,
        );
        const receipt = await transaction.wait();
        setAdminTransaction({
          hash: transaction.hash,
          blockNumber: receipt.blockNumber,
          contractAddress: import.meta.env.VITE_CONTRACT_ADDRESS,
        });
        setInstitutionApproved(approved);
        setAdminMessage(
          approved
            ? "Institution approved successfully."
            : "Institution approval removed.",
        );
        const activityResponse = await fetch(
          "/api/admin/activity",
          adminRequestInit(),
        );
        const activityData = await activityResponse.json();
        if (activityResponse.ok) setActivity(activityData.activity);
      } catch (error) {
        setAdminMessage(
          error instanceof Error ? error.message : "Unable to update institution",
        );
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
            onClick={() => {
              setView("issue");
              setInstitutionStatus(null);
              setInstitutionHistory([]);
            }}
          >
            Institution portal
          </button>
          <button
            className={view === "admin" ? "tab active" : "tab"}
            onClick={() => {
              setView("admin");
              void loadAdministrator();
            }}
          >
            Admin controls
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
            <button
              type="button"
              className="secondary-button"
              onClick={() => setScannerOpen((open) => !open)}
            >
              {scannerOpen ? "Close QR scanner" : "Scan QR code"}
            </button>
            {scannerOpen && (
              <QrScanner
                onScan={(id) => {
                  setScannerOpen(false);
                  setCertificateId(id);
                  void verifyCertificate(id);
                }}
              />
            )}
            {message && <p className="message error">{message}</p>}
            {verification && <VerificationCard result={verification} />}
          </div>
        ) : view === "issue" ? (
          <div className="panel issue-panel">
            <div className="panel-heading">
              <p className="section-number">02 / INSTITUTION PORTAL</p>
              <h2>Issue a new credential.</h2>
              <p>
                Only an approved institution wallet connected through MetaMask
                can issue a certificate.
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
            <p className={`approval-status ${institutionStatus ? "approved" : "not-approved"}`}>
              {walletAddress
                ? institutionStatus
                  ? "Connected wallet is an approved institution."
                  : "Connected wallet is not approved."
                : "Connect an approved institution wallet to continue."}
            </p>
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
              <button
                className="primary-button full-width"
                disabled={loading || !walletAddress || !institutionStatus}
              >
                {loading ? "Issuing..." : "Issue certificate"}
              </button>
            </form>
            {message && <p className="message">{message}</p>}
            {issuedCertificate && (
              <IssuedCard certificate={issuedCertificate} onRevoke={revoke} />
            )}
            <CertificateHistory certificates={institutionHistory} />
          </div>
        ) : (
          <div className="panel admin-panel">
            <div className="panel-heading">
              <p className="section-number">03 / ADMIN CONTROLS</p>
              <h2>Manage trusted institutions.</h2>
              <p>
                The administrator can approve institutions before they issue
                certificates. Changes are recorded by the smart contract.
              </p>
            </div>
            <div className="result-card">
              <div className="result-top">
                <span className="status-pill">ADMINISTRATOR</span>
                <span>Contract role</span>
              </div>
              <code>{administrator || "Loading..."}</code>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void connectWallet().catch((error) =>
                setAdminMessage(
                  error instanceof Error ? error.message : "Wallet connection failed",
                ),
              )}
            >
              {walletAddress
                ? `Connected wallet: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                : "Connect administrator wallet"}
            </button>
            <form
              className="admin-form"
              onSubmit={(event) => {
                event.preventDefault();
                void checkInstitution();
              }}
            >
              <label htmlFor="institution-address">Institution wallet address</label>
              <div className="input-row">
                <input
                  id="institution-address"
                  value={institutionAddress}
                  onChange={(event) => setInstitutionAddress(event.target.value)}
                  placeholder="0x..."
                />
                <button className="secondary-button" disabled={loading}>
                  Check status
                </button>
              </div>
            </form>
            {institutionApproved !== null && (
              <p className={`approval-status ${institutionApproved ? "approved" : "not-approved"}`}>
                {institutionApproved ? "Approved institution" : "Not approved"}
              </p>
            )}
            <div className="admin-actions">
              <button
                className="primary-button"
                disabled={loading || !institutionAddress.trim()}
                onClick={() => void updateInstitution(true)}
              >
                {loading ? "Updating..." : "Approve institution"}
              </button>
              <button
                className="danger-button"
                disabled={loading || !institutionAddress.trim()}
                onClick={() => void updateInstitution(false)}
              >
                Remove approval
              </button>
            </div>
            {adminMessage && <p className="message">{adminMessage}</p>}
            {adminTransaction && <TransactionDetails transaction={adminTransaction} />}
            <ActivityFeed
              activity={activity}
              typeFilter={activityType}
              search={activitySearch}
              onTypeFilterChange={setActivityType}
              onSearchChange={setActivitySearch}
            />
            {institutionApproved !== null && (
              <button
                className="secondary-button history-button"
                onClick={() => void loadInstitutionHistory(institutionAddress)}
              >
                Refresh institution history
              </button>
            )}
            <CertificateHistory certificates={institutionHistory} />
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
  const verificationUrl = `${window.location.origin}/?certificateId=${encodeURIComponent(certificate.id)}`;

  return (
    <article className="result-card issued-card">
      <div className="result-top">
        <span className="status-pill">
          {certificate.revokedAt ? "REVOKED" : "CREATED"}
        </span>
        <span>Certificate ID generated</span>
      </div>
      <code>{certificate.id}</code>
      <div className="qr-card">
        <p>Scan to verify this certificate</p>
        <QRCodeCanvas value={verificationUrl} size={180} includeMargin />
        <a href={verificationUrl} target="_blank" rel="noreferrer">
          Open verification link
        </a>
      </div>
      <button
        className="danger-button"
        onClick={onRevoke}
        disabled={Boolean(certificate.revokedAt)}
      >
        Revoke certificate
      </button>
      {certificate.transaction && (
        <TransactionDetails transaction={certificate.transaction} />
      )}
    </article>
  );
}

function CertificateHistory({ certificates }: { certificates: Certificate[] }) {
  if (!certificates.length) return null;
  return (
    <section className="history">
      <h3>Certificate history</h3>
      {certificates.map((certificate) => (
        <div className="history-row" key={certificate.id}>
          <span>{certificate.skillName}</span>
          <span>{certificate.revokedAt ? "REVOKED" : "ACTIVE"}</span>
          <code>{certificate.id}</code>
        </div>
      ))}
    </section>
  );
}

function TransactionDetails({ transaction }: { transaction: TransactionInfo }) {
  return (
    <div className="transaction-details">
      <strong>Blockchain transaction</strong>
      <span>Block {transaction.blockNumber}</span>
      <code>{transaction.hash}</code>
      <small>Contract: {transaction.contractAddress}</small>
    </div>
  );
}

function ActivityFeed({
  activity,
  typeFilter,
  search,
  onTypeFilterChange,
  onSearchChange,
}: {
  activity: ActivityEvent[];
  typeFilter: "ALL" | ActivityEvent["type"];
  search: string;
  onTypeFilterChange: (value: "ALL" | ActivityEvent["type"]) => void;
  onSearchChange: (value: string) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const filteredActivity = activity.filter((event) => {
    if (typeFilter !== "ALL" && event.type !== typeFilter) return false;
    if (!normalizedSearch) return true;
    return [
      event.institution,
      event.certificateId,
      event.actor,
      event.transaction.hash,
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedSearch));
  });

  return (
    <section className="activity-feed">
      <div className="result-top">
        <h3>Administrator activity</h3>
        <span>
          {filteredActivity.length} of {activity.length} events
        </span>
      </div>
      <div className="activity-filters">
        <label>
          Event type
          <select
            value={typeFilter}
            onChange={(event) =>
              onTypeFilterChange(
                event.target.value as "ALL" | ActivityEvent["type"],
              )
            }
          >
            <option value="ALL">All events</option>
            <option value="INSTITUTION_APPROVAL">Institution approvals</option>
            <option value="CERTIFICATE_ISSUED">Certificate issuance</option>
            <option value="CERTIFICATE_REVOKED">Certificate revocations</option>
          </select>
        </label>
        <label>
          Search address, ID, or transaction
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search activity"
          />
        </label>
      </div>
      {!filteredActivity.length ? (
        <p className="muted">No blockchain activity recorded yet.</p>
      ) : (
        filteredActivity.map((event) => (
          <div className="activity-row" key={`${event.transaction.hash}-${event.type}`}>
            <strong>
              {event.type === "INSTITUTION_APPROVAL"
                ? `Institution ${event.approved ? "approved" : "removed"}`
                : event.type === "CERTIFICATE_ISSUED"
                  ? "Certificate issued"
                  : "Certificate revoked"}
            </strong>
            <span>{new Date(event.timestamp).toLocaleString()}</span>
            <code>{event.institution ?? event.certificateId ?? event.actor}</code>
            <small>Block {event.transaction.blockNumber} · {event.transaction.hash}</small>
          </div>
        ))
      )}
    </section>
  );
}

function QrScanner({ onScan }: { onScan: (certificateId: string) => void }) {
  useEffect(() => {
    const scanner = new Html5Qrcode("certificate-qr-reader");
    let stopped = false;

    void scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          try {
            const url = new URL(decodedText);
            const id = url.searchParams.get("certificateId");
            if (id) onScan(id);
          } catch {
            onScan(decodedText);
          }
        },
        () => undefined,
      )
      .catch(() => undefined);

    return () => {
      if (!stopped) {
        stopped = true;
        void scanner.stop().catch(() => undefined);
      }
    };
  }, [onScan]);

  return (
    <div className="qr-scanner">
      <p>Allow camera access and point it at a certificate QR code.</p>
      <div id="certificate-qr-reader" />
    </div>
  );
}

export default App;
