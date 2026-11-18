// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SkillShieldRegistry} from "../contracts/SkillShieldRegistry.sol";
import {MockAgentIdRegistry} from "../contracts/MockAgentIdRegistry.sol";

/// @dev Minimal cheatcode interface — keeps the project free of test
///      framework dependencies while running under `forge test`.
interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
}

contract SkillShieldRegistryTest {
    Vm private constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    MockAgentIdRegistry private mock;
    SkillShieldRegistry private registry;

    address private constant PUBLISHER = address(0xA11CE);
    address private constant REVIEWER = address(0xB0B);
    address private constant REVIEWER2 = address(0xCAFE);
    address private constant STRANGER = address(0xDEAD);

    bytes32 private constant HASH1 = bytes32(uint256(0x1111));
    bytes32 private constant HASH2 = bytes32(uint256(0x2222));

    function setUp() public {
        mock = new MockAgentIdRegistry();
        mock.setHandle(PUBLISHER, "publisher");
        mock.setHandle(REVIEWER, "reviewer");
        mock.setHandle(REVIEWER2, "reviewer2");
        registry = new SkillShieldRegistry(address(mock));
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _register() internal returns (uint256) {
        vm.prank(PUBLISHER);
        return registry.registerSkill(HASH1, "demo-skill", "1.0.0", "ipfs://demo");
    }

    function assertEq(uint256 a, uint256 b, string memory what) internal pure {
        require(a == b, string.concat("assertEq failed: ", what));
    }

    function assertTrue(bool a, string memory what) internal pure {
        require(a, string.concat("assertTrue failed: ", what));
    }

    // ── Registration ────────────────────────────────────────────────────────

    function testHolderRegisters() public {
        uint256 id = _register();
        assertEq(id, 1, "first id is 1");
        SkillShieldRegistry.Skill memory s = registry.getSkill(id);
        assertEq(uint256(s.contentHash), uint256(HASH1), "hash stored");
        assertTrue(s.publisher == PUBLISHER, "publisher stored");
        assertEq(s.publisherTokenId, uint256(keccak256(bytes("publisher"))), "publisher tokenId derived from handle");
        assertEq(registry.totalSkills(), 1, "totalSkills");
        assertEq(registry.skillIdByHash(HASH1), id, "lookup by hash");
        assertEq(registry.skillIdByHash(HASH2), 0, "unknown hash is 0");
    }

    function testNonHolderCannotRegister() public {
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(SkillShieldRegistry.NotAgentIdHolder.selector));
        registry.registerSkill(HASH1, "demo-skill", "1.0.0", "");
    }

    function testDuplicateHashReverts() public {
        _register();
        vm.prank(REVIEWER);
        vm.expectRevert(abi.encodeWithSelector(SkillShieldRegistry.HashAlreadyRegistered.selector));
        registry.registerSkill(HASH1, "copycat", "9.9.9", "");
    }

    function testZeroHashReverts() public {
        vm.prank(PUBLISHER);
        vm.expectRevert(abi.encodeWithSelector(SkillShieldRegistry.HashZero.selector));
        registry.registerSkill(bytes32(0), "demo-skill", "1.0.0", "");
    }

    // ── Revocation ──────────────────────────────────────────────────────────

    function testPublisherRevokes() public {
        uint256 id = _register();
        vm.prank(PUBLISHER);
        registry.revokeSkill(id);
        assertTrue(registry.getSkill(id).revoked, "revoked flag set");
    }

    function testNonPublisherCannotRevoke() public {
        uint256 id = _register();
        vm.prank(REVIEWER);
        vm.expectRevert(abi.encodeWithSelector(SkillShieldRegistry.NotPublisher.selector));
        registry.revokeSkill(id);
    }

    function testDoubleRevokeReverts() public {
        uint256 id = _register();
        vm.prank(PUBLISHER);
        registry.revokeSkill(id);
        vm.prank(PUBLISHER);
        vm.expectRevert(abi.encodeWithSelector(SkillShieldRegistry.AlreadyRevoked.selector));
        registry.revokeSkill(id);
    }

    // ── Reviews ─────────────────────────────────────────────────────────────

    function testNonHolderCannotReview() public {
        uint256 id = _register();
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(SkillShieldRegistry.NotAgentIdHolder.selector));
        registry.review(id, true, 0);
    }

    function testSelfReviewReverts() public {
        uint256 id = _register();
        vm.prank(PUBLISHER);
        vm.expectRevert(abi.encodeWithSelector(SkillShieldRegistry.SelfReview.selector));
        registry.review(id, true, 0);
    }

    function testReviewCounting() public {
        uint256 id = _register();
        vm.prank(REVIEWER);
        registry.review(id, true, 0);
        vm.prank(REVIEWER2);
        registry.review(id, false, 2);
        SkillShieldRegistry.Skill memory s = registry.getSkill(id);
        assertEq(s.trustCount, 1, "one trust");
        assertEq(s.flagCount, 1, "one flag");
    }

    function testStanceReplacementKeepsCountsCorrect() public {
        uint256 id = _register();
        vm.prank(REVIEWER);
        registry.review(id, true, 0);
        vm.prank(REVIEWER);
        registry.review(id, false, 1); // flip trust -> flag
        SkillShieldRegistry.Skill memory s = registry.getSkill(id);
        assertEq(s.trustCount, 0, "trust decremented on flip");
        assertEq(s.flagCount, 1, "flag incremented on flip");

        vm.prank(REVIEWER);
        registry.review(id, false, 4); // same stance, new reason: counts unchanged
        s = registry.getSkill(id);
        assertEq(s.flagCount, 1, "flag count unchanged on reason update");
        SkillShieldRegistry.Review memory r = registry.getReview(id, uint256(keccak256(bytes("reviewer"))));
        assertTrue(r.exists && !r.trusted && r.reason == 4, "stored stance updated");
    }

    function testInvalidReasonReverts() public {
        uint256 id = _register();
        vm.prank(REVIEWER);
        vm.expectRevert(abi.encodeWithSelector(SkillShieldRegistry.InvalidReason.selector));
        registry.review(id, false, 0); // a flag must carry a reason
    }

    function testReviewOfRevokedReverts() public {
        uint256 id = _register();
        vm.prank(PUBLISHER);
        registry.revokeSkill(id);
        vm.prank(REVIEWER);
        vm.expectRevert(abi.encodeWithSelector(SkillShieldRegistry.SkillIsRevoked.selector));
        registry.review(id, true, 0);
    }

    function testUnknownSkillReverts() public {
        vm.prank(REVIEWER);
        vm.expectRevert(abi.encodeWithSelector(SkillShieldRegistry.SkillNotFound.selector));
        registry.review(42, true, 0);
    }
}
