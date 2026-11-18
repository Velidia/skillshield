// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Test double for the SPACE ID Agent ID registry. An account
///         "holds" an Agent ID iff it has been assigned a non-empty handle,
///         mirroring the real registry's balanceOf/handleOf behaviour.
contract MockAgentIdRegistry {
    mapping(address account => string handle) private _handles;

    function setHandle(address account, string calldata handle) external {
        _handles[account] = handle;
    }

    function balanceOf(address account) external view returns (uint256) {
        return bytes(_handles[account]).length == 0 ? 0 : 1;
    }

    function handleOf(address account) external view returns (string memory) {
        return _handles[account];
    }
}
