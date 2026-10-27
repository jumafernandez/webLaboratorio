// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ConRelayers} from "./ConRelayers.sol";

/// @notice Level 1: timestamps a short message on-chain on behalf of its author.
contract SelloLICDIA is ConRelayers {
    uint256 public constant MAX_MENSAJE = 120;

    uint256 public totalSellos;
    mapping(uint256 => bytes32) public huella;
    mapping(uint256 => address) public autorDe;

    event Sellado(uint256 indexed id, address indexed autor, bytes32 huella, string mensaje);

    error MensajeInvalido(uint256 largo);

    /// @return id Sequential stamp id, starting at 1.
    function sellar(address autor, string calldata mensaje) external soloRelayer returns (uint256 id) {
        if (autor == address(0)) revert DireccionInvalida();
        uint256 largo = bytes(mensaje).length;
        if (largo == 0 || largo > MAX_MENSAJE) revert MensajeInvalido(largo);
        id = ++totalSellos;
        bytes32 h = keccak256(bytes(mensaje));
        huella[id] = h;
        autorDe[id] = autor;
        emit Sellado(id, autor, h, mensaje);
    }

    /// @notice Checks whether a message matches a stored stamp (the tamper demo).
    function verificar(uint256 id, string calldata mensaje) external view returns (bool) {
        return id != 0 && id <= totalSellos && huella[id] == keccak256(bytes(mensaje));
    }
}
