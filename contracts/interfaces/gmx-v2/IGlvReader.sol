// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

interface IGlvReader {
    struct Props {
        address glvToken;
        address longToken;
        address shortToken;
    }

    struct GlvInfo {
        Props glv;
        address[] markets;
    }

    function getGlv(address dataStore, address key) external view returns (Props memory);

    function getGlvInfo(address dataStore, address glv) external view returns (GlvInfo memory);
}