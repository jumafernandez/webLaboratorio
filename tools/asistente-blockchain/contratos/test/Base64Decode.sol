// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal base64 decoder used by the tests to inspect on-chain metadata.
library Base64Decode {
    function decode(string memory s) internal pure returns (bytes memory out) {
        bytes memory b = bytes(s);
        require(b.length % 4 == 0, "base64: largo");
        uint256 pad = 0;
        if (b.length > 0 && b[b.length - 1] == "=") pad++;
        if (b.length > 1 && b[b.length - 2] == "=") pad++;
        out = new bytes((b.length / 4) * 3 - pad);
        uint256 j = 0;
        for (uint256 i = 0; i < b.length; i += 4) {
            uint256 n = (_v(b[i]) << 18) | (_v(b[i + 1]) << 12) | (_v(b[i + 2]) << 6) | _v(b[i + 3]);
            if (j < out.length) out[j++] = bytes1(uint8(n >> 16));
            if (j < out.length) out[j++] = bytes1(uint8(n >> 8));
            if (j < out.length) out[j++] = bytes1(uint8(n));
        }
    }

    function _v(bytes1 c) private pure returns (uint256) {
        uint8 x = uint8(c);
        if (x >= 65 && x <= 90) return x - 65;
        if (x >= 97 && x <= 122) return x - 71;
        if (x >= 48 && x <= 57) return x + 4;
        if (x == 43) return 62;
        if (x == 47) return 63;
        if (x == 61) return 0;
        revert("base64: caracter");
    }
}
