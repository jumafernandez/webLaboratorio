// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CredencialLICDIA} from "../src/CredencialLICDIA.sol";

/// @notice Deploys CredencialLICDIA with the broadcaster as owner. Run by a human with the curso-dapps keystore.
contract Desplegar is Script {
    function run() external returns (CredencialLICDIA c) {
        vm.startBroadcast();
        c = new CredencialLICDIA(msg.sender);
        vm.stopBroadcast();
        console.log("CredencialLICDIA", address(c));
        console.log("owner", msg.sender);
        console.log("block", block.number);
    }
}
