// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SelloLICDIA} from "../src/SelloLICDIA.sol";
import {InsigniasLICDIA} from "../src/InsigniasLICDIA.sol";
import {FabricaTokens} from "../src/FabricaTokens.sol";
import {USDLDemo} from "../src/USDLDemo.sol";
import {PasarelaDemo} from "../src/PasarelaDemo.sol";

/// @notice Deploys the five demo contracts, authorizes the relayer, wires USDL/Pasarela/Insignias and writes
/// deploy/<chainid>.json for the backend.
/// Env: RELAYER (required), COMERCIO (optional, defaults to the deployer).
contract Desplegar is Script {
    function run() external {
        address relayer = vm.envAddress("RELAYER");
        uint256 bloque = block.number;

        vm.startBroadcast();
        address yo = msg.sender;
        address comercio = vm.envOr("COMERCIO", yo);

        SelloLICDIA sello = new SelloLICDIA();
        InsigniasLICDIA insignias = new InsigniasLICDIA();
        FabricaTokens fabrica = new FabricaTokens();
        USDLDemo usdl = new USDLDemo();
        PasarelaDemo pasarela = new PasarelaDemo(usdl, insignias, comercio);

        usdl.setPasarela(address(pasarela));
        insignias.setRelayer(address(pasarela), true);
        sello.setRelayer(relayer, true);
        insignias.setRelayer(relayer, true);
        fabrica.setRelayer(relayer, true);
        pasarela.setRelayer(relayer, true);
        vm.stopBroadcast();

        string memory c = "contratos";
        vm.serializeAddress(c, "SelloLICDIA", address(sello));
        vm.serializeAddress(c, "InsigniasLICDIA", address(insignias));
        vm.serializeAddress(c, "FabricaTokens", address(fabrica));
        vm.serializeAddress(c, "USDLDemo", address(usdl));
        string memory contratos = vm.serializeAddress(c, "PasarelaDemo", address(pasarela));

        string memory r = "raiz";
        vm.serializeUint(r, "chainId", block.chainid);
        vm.serializeString(r, "contratos", contratos);
        vm.serializeAddress(r, "relayer", relayer);
        vm.serializeAddress(r, "comercio", comercio);
        vm.serializeAddress(r, "owner", yo);
        string memory json = vm.serializeUint(r, "bloque", bloque);

        string memory ruta = string.concat(vm.projectRoot(), "/deploy/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, ruta);
        console2.log("deploy escrito en", ruta);
    }
}
