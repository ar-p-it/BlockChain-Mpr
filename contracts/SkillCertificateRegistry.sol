// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SkillCertificateRegistry {
    enum Status {
        Active,
        Revoked
    }

    struct Certificate {
        bytes32 certificateHash;
        bytes32 recipientHash;
        string skillName;
        address issuer;
        uint256 issuedAt;
        uint256 expiresAt;
        Status status;
    }

    address public immutable administrator;
    mapping(address => bool) public approvedInstitutions;
    mapping(bytes32 => Certificate) private certificates;

    event InstitutionApprovalUpdated(address indexed institution, bool approved);
    event CertificateIssued(bytes32 indexed certificateId, address indexed issuer);
    event CertificateRevoked(bytes32 indexed certificateId, address indexed issuer);

    modifier onlyAdministrator() {
        require(msg.sender == administrator, 'Only administrator');
        _;
    }

    modifier onlyApprovedInstitution() {
        require(approvedInstitutions[msg.sender], 'Institution is not approved');
        _;
    }

    constructor() {
        administrator = msg.sender;
    }

    function setInstitutionApproval(address institution, bool approved)
        external
        onlyAdministrator
    {
        approvedInstitutions[institution] = approved;
        emit InstitutionApprovalUpdated(institution, approved);
    }

    function issueCertificate(
        bytes32 certificateId,
        bytes32 certificateHash,
        bytes32 recipientHash,
        string calldata skillName,
        uint256 expiresAt
    ) external onlyApprovedInstitution {
        require(certificates[certificateId].issuedAt == 0, 'Certificate already exists');
        require(bytes(skillName).length > 0, 'Skill name is required');
        require(expiresAt == 0 || expiresAt > block.timestamp, 'Invalid expiration');

        certificates[certificateId] = Certificate({
            certificateHash: certificateHash,
            recipientHash: recipientHash,
            skillName: skillName,
            issuer: msg.sender,
            issuedAt: block.timestamp,
            expiresAt: expiresAt,
            status: Status.Active
        });

        emit CertificateIssued(certificateId, msg.sender);
    }

    function revokeCertificate(bytes32 certificateId) external {
        Certificate storage certificate = certificates[certificateId];
        require(certificate.issuedAt != 0, 'Certificate does not exist');
        require(
            msg.sender == certificate.issuer || msg.sender == administrator,
            'Not authorized to revoke'
        );
        require(certificate.status == Status.Active, 'Certificate is already revoked');

        certificate.status = Status.Revoked;
        emit CertificateRevoked(certificateId, msg.sender);
    }

    function getCertificate(bytes32 certificateId)
        external
        view
        returns (Certificate memory)
    {
        require(certificates[certificateId].issuedAt != 0, 'Certificate does not exist');
        return certificates[certificateId];
    }
}
