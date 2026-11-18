// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal view of the SPACE ID Agent ID registry (BSC mainnet:
///         0x60b9262456de011f7d15a54cdd8c48baaa8b022f). Soulbound ERC-721:
///         one Agent ID per account, tokenId = uint256(keccak256(bytes(handle))).
interface IAgentIdRegistry {
    function balanceOf(address owner) external view returns (uint256);
    function handleOf(address owner) external view returns (string memory);
}

/// @title SkillShieldRegistry
/// @notice On-chain integrity and community-review registry for third-party
///         AI agent skill packages. A registration proves that an Agent ID
///         holder published a specific SHA-256 package digest at a point in
///         time; reviews record the community stance per Agent ID. It does
///         NOT prove a skill is safe — see SPEC.md.
contract SkillShieldRegistry {
    struct Skill {
        bytes32 contentHash;
        address publisher;
        uint256 publisherTokenId;
        string name;
        string version;
        string uri;
        bool revoked;
        uint256 trustCount;
        uint256 flagCount;
        uint256 registeredAt;
    }

    struct Review {
        bool exists;
        bool trusted;
        uint8 reason; // flags: 1 malicious code, 2 prompt injection,
        // 3 impersonation, 4 unsafe permissions, 5 other; 0 = none/trusted
    }

    IAgentIdRegistry public immutable agentIdRegistry;

    Skill[] private _skills;
    mapping(bytes32 contentHash => uint256 skillId) private _idByHash;
    mapping(uint256 skillId => mapping(uint256 tokenId => Review)) private _reviews;

    event SkillRegistered(
        uint256 indexed skillId,
        bytes32 indexed contentHash,
        address indexed publisher,
        uint256 publisherTokenId,
        string name,
        string version,
        string uri
    );
    event SkillRevoked(uint256 indexed skillId, address indexed publisher);
    event SkillReviewed(uint256 indexed skillId, uint256 indexed reviewerTokenId, bool trusted, uint8 reason);

    error NotAgentIdHolder();
    error EmptyHandle();
    error HashZero();
    error HashAlreadyRegistered();
    error EmptyField();
    error SkillNotFound();
    error NotPublisher();
    error AlreadyRevoked();
    error SkillIsRevoked();
    error SelfReview();
    error InvalidReason();

    constructor(address agentIdRegistry_) {
        agentIdRegistry = IAgentIdRegistry(agentIdRegistry_);
    }

    // ── Writes ──────────────────────────────────────────────────────────────

    /// @notice Register a skill package digest. One registration per hash.
    /// @return skillId The new skill id (ids start at 1).
    function registerSkill(bytes32 contentHash, string calldata name, string calldata version, string calldata uri)
        external
        returns (uint256 skillId)
    {
        uint256 publisherTokenId = _agentTokenId(msg.sender);
        if (contentHash == bytes32(0)) revert HashZero();
        if (_idByHash[contentHash] != 0) revert HashAlreadyRegistered();
        if (bytes(name).length == 0 || bytes(version).length == 0) revert EmptyField();

        _skills.push(
            Skill({
                contentHash: contentHash,
                publisher: msg.sender,
                publisherTokenId: publisherTokenId,
                name: name,
                version: version,
                uri: uri,
                revoked: false,
                trustCount: 0,
                flagCount: 0,
                registeredAt: block.timestamp
            })
        );
        skillId = _skills.length;
        _idByHash[contentHash] = skillId;
        emit SkillRegistered(skillId, contentHash, msg.sender, publisherTokenId, name, version, uri);
    }

    /// @notice Mark one of your own registrations revoked (e.g. the version
    ///         was compromised or superseded after a security incident).
    function revokeSkill(uint256 skillId) external {
        Skill storage skill = _skill(skillId);
        _agentTokenId(msg.sender);
        if (msg.sender != skill.publisher) revert NotPublisher();
        if (skill.revoked) revert AlreadyRevoked();
        skill.revoked = true;
        emit SkillRevoked(skillId, msg.sender);
    }

    /// @notice Record or replace your stance on a skill. One stance per
    ///         Agent ID; replacing it keeps the counts correct.
    /// @param trusted True to vouch, false to flag (reason 1–5 required).
    function review(uint256 skillId, bool trusted, uint8 reason) external {
        Skill storage skill = _skill(skillId);
        uint256 reviewerTokenId = _agentTokenId(msg.sender);
        if (skill.revoked) revert SkillIsRevoked();
        if (reviewerTokenId == skill.publisherTokenId) revert SelfReview();
        if (trusted ? reason != 0 : (reason == 0 || reason > 5)) revert InvalidReason();

        Review storage stance = _reviews[skillId][reviewerTokenId];
        if (stance.exists) {
            if (stance.trusted) skill.trustCount -= 1;
            else skill.flagCount -= 1;
        }
        stance.exists = true;
        stance.trusted = trusted;
        stance.reason = reason;
        if (trusted) skill.trustCount += 1;
        else skill.flagCount += 1;
        emit SkillReviewed(skillId, reviewerTokenId, trusted, reason);
    }

    // ── Views ───────────────────────────────────────────────────────────────

    function getSkill(uint256 skillId) external view returns (Skill memory) {
        return _skill(skillId);
    }

    function getReview(uint256 skillId, uint256 tokenId) external view returns (Review memory) {
        if (skillId == 0 || skillId > _skills.length) revert SkillNotFound();
        return _reviews[skillId][tokenId];
    }

    /// @return The skill id for a package digest, or 0 if unregistered.
    function skillIdByHash(bytes32 contentHash) external view returns (uint256) {
        return _idByHash[contentHash];
    }

    function totalSkills() external view returns (uint256) {
        return _skills.length;
    }

    // ── Internals ───────────────────────────────────────────────────────────

    /// @dev Identity is the Agent ID tokenId, not the raw address: the ID is
    ///      soulbound and unique per account, so one person gets one stance.
    function _agentTokenId(address account) internal view returns (uint256) {
        if (agentIdRegistry.balanceOf(account) < 1) revert NotAgentIdHolder();
        string memory handle = agentIdRegistry.handleOf(account);
        if (bytes(handle).length == 0) revert EmptyHandle();
        return uint256(keccak256(bytes(handle)));
    }

    function _skill(uint256 skillId) internal view returns (Skill storage skill) {
        if (skillId == 0 || skillId > _skills.length) revert SkillNotFound();
        skill = _skills[skillId - 1];
    }
}
