// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CredencialLICDIA} from "../src/CredencialLICDIA.sol";

/// @notice Deploys CredencialLICDIA with the broadcaster as admin (DEFAULT_ADMIN_ROLE + EMISOR_ROLE) and records it in
/// deploy/<chainid>.json under "credenciales" (same shape as blockchain-dev/verificar/config.json) and
/// "contratos.CredencialLICDIA". Other keys of that file (the game contracts) are kept.
/// Env: EMISOR (optional): an extra address that gets EMISOR_ROLE (e.g. the university's issuing wallet).
contract DesplegarCredencial is Script {
    function run() external returns (CredencialLICDIA cred) {
        address emisorExtra = vm.envOr("EMISOR", address(0));
        uint256 bloque = block.number;

        vm.startBroadcast();
        address yo = msg.sender;
        cred = new CredencialLICDIA(yo);
        if (emisorExtra != address(0) && emisorExtra != yo) cred.grantRole(cred.EMISOR_ROLE(), emisorExtra);
        vm.stopBroadcast();

        string memory k = "credenciales";
        vm.serializeAddress(k, "address", address(cred));
        vm.serializeAddress(k, "admin", yo);
        vm.serializeAddress(k, "emisor", emisorExtra == address(0) ? yo : emisorExtra);
        string memory credJson = vm.serializeUint(k, "bloque", bloque);

        string memory ruta = string.concat(vm.projectRoot(), "/deploy/", vm.toString(block.chainid), ".json");
        string memory r = "raiz";
        if (vm.exists(ruta)) {
            // Re-serialize the existing file so the game contracts' entries survive.
            string memory previo = vm.readFile(ruta);
            vm.serializeJson(r, previo);
            string memory c = "contratos";
            if (vm.keyExistsJson(previo, ".contratos")) {
                string[] memory nombres = vm.parseJsonKeys(previo, ".contratos");
                for (uint256 i = 0; i < nombres.length; i++) {
                    string memory clave = string.concat(".contratos.", nombres[i]);
                    vm.serializeAddress(c, nombres[i], vm.parseJsonAddress(previo, clave));
                }
            }
            string memory contratos = vm.serializeAddress(c, "CredencialLICDIA", address(cred));
            vm.serializeString(r, "contratos", contratos);
        } else {
            vm.serializeUint(r, "chainId", block.chainid);
            vm.serializeString(r, "contratos", vm.serializeAddress("contratos", "CredencialLICDIA", address(cred)));
        }
        string memory json = vm.serializeString(r, "credenciales", credJson);
        vm.writeJson(json, ruta);

        console2.log("CredencialLICDIA", address(cred));
        console2.log("bloque", bloque);
        console2.log("deploy escrito en", ruta);
    }
}
