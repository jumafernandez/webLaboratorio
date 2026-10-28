// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CredencialLICDIA} from "../src/CredencialLICDIA.sol";

/// @notice Issues credentials in batches (emitirLote) from a JSON file:
/// {"cohorte": 2026, "egresados": [{"direccion": "0x…", "alcance": 0, "actoHash": "0x<sha256 del PDF>",
///   "nombre": "…", "mencion": ""}, …]}
/// Rows whose (direccion, cohorte, alcance) already hold a live credential are skipped, so a partial run can simply
/// be repeated. Everything is validated before broadcasting; a bad row aborts the whole run.
/// Env: ARCHIVO (required, path under ./emisiones), CREDENCIAL (optional; default: credenciales.address from
/// deploy/<chainid>.json), LOTE (optional batch size, default 20, max MAX_LOTE).
contract EmitirCredenciales is Script {
    function run() external {
        string memory json = vm.readFile(vm.envString("ARCHIVO"));
        CredencialLICDIA cred = CredencialLICDIA(_direccionContrato());
        uint256 lote = vm.envOr("LOTE", uint256(20));
        require(lote > 0 && lote <= cred.MAX_LOTE(), "LOTE fuera de rango");

        uint16 cohorte = uint16(vm.parseJsonUint(json, ".cohorte"));
        require(cohorte >= 2026 && cohorte <= 2100, "cohorte invalida");
        uint256 n = _contar(json);

        CredencialLICDIA.Emision[] memory todas = new CredencialLICDIA.Emision[](n);
        uint256 pendientes;
        for (uint256 i = 0; i < n; i++) {
            string memory p = string.concat(".egresados[", vm.toString(i), "]");
            CredencialLICDIA.Emision memory e = CredencialLICDIA.Emision({
                a: vm.parseJsonAddress(json, string.concat(p, ".direccion")),
                alcance: uint8(vm.parseJsonUint(json, string.concat(p, ".alcance"))),
                actoHash: vm.parseJsonBytes32(json, string.concat(p, ".actoHash")),
                nombre: vm.parseJsonString(json, string.concat(p, ".nombre")),
                mencion: vm.keyExistsJson(json, string.concat(p, ".mencion"))
                    ? vm.parseJsonString(json, string.concat(p, ".mencion"))
                    : ""
            });
            _validar(e, i);
            uint256 previa = cred.credencialDe(e.a, cohorte, e.alcance);
            if (previa != 0) {
                (bool vigente,,) = cred.verify(previa);
                if (vigente) {
                    console2.log("ya emitida, se omite fila", i, "token", previa);
                    continue;
                }
            }
            todas[pendientes++] = e;
        }
        console2.log("filas", n, "a emitir", pendientes);
        if (pendientes == 0) return;

        vm.startBroadcast();
        for (uint256 desde = 0; desde < pendientes; desde += lote) {
            uint256 hasta = desde + lote < pendientes ? desde + lote : pendientes;
            CredencialLICDIA.Emision[] memory parte = new CredencialLICDIA.Emision[](hasta - desde);
            for (uint256 j = desde; j < hasta; j++) {
                parte[j - desde] = todas[j];
            }
            uint256 primero = cred.emitirLote(cohorte, parte);
            console2.log("lote emitido, tokens", primero, "a", primero + parte.length - 1);
        }
        vm.stopBroadcast();
    }

    function _direccionContrato() internal view returns (address) {
        address dir = vm.envOr("CREDENCIAL", address(0));
        if (dir != address(0)) return dir;
        string memory ruta = string.concat(vm.projectRoot(), "/deploy/", vm.toString(block.chainid), ".json");
        return vm.parseJsonAddress(vm.readFile(ruta), ".credenciales.address");
    }

    function _contar(string memory json) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(".egresados[", vm.toString(n), "]"))) n++;
        require(n > 0, "sin egresados");
    }

    /// @dev Mirrors the contract checks so a bad file fails here, before any transaction is sent.
    function _validar(CredencialLICDIA.Emision memory e, uint256 fila) internal pure {
        uint256 largo = bytes(e.nombre).length;
        if (e.a == address(0) || e.alcance > 4 || e.actoHash == bytes32(0) || largo == 0 || largo > 64) {
            revert(string.concat("fila invalida: ", vm.toString(fila)));
        }
        require(bytes(e.mencion).length <= 64, string.concat("mencion larga en fila ", vm.toString(fila)));
    }
}
