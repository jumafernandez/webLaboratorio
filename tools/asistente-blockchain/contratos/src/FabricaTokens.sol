// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ConRelayers} from "./ConRelayers.sol";

/// @notice Plain ERC-20 created by the factory; the whole supply goes to its owner.
contract TokenSimple is ERC20 {
    constructor(string memory nombre, string memory simbolo, address dueno, uint256 supply) ERC20(nombre, simbolo) {
        _mint(dueno, supply * 1e18);
    }
}

/// @notice Level 2: deploys an ERC-20 on behalf of the visitor.
contract FabricaTokens is ConRelayers {
    uint256 public constant MAX_NOMBRE = 24;
    uint256 public constant MAX_SIMBOLO = 5;
    uint256 public constant MAX_SUPPLY = 21_000_000;

    uint256 public totalTokens;
    mapping(address => address[]) private _tokensDe;

    event TokenCreado(address indexed token, address indexed dueno, string nombre, string simbolo, uint256 supply);

    error NombreInvalido();
    error SimboloInvalido();
    error SupplyInvalido(uint256 supply);

    function crear(address dueno, string calldata nombre, string calldata simbolo, uint256 supply)
        external
        soloRelayer
        returns (address token)
    {
        if (dueno == address(0)) revert DireccionInvalida();
        uint256 ln = bytes(nombre).length;
        if (ln == 0 || ln > MAX_NOMBRE) revert NombreInvalido();
        uint256 ls = bytes(simbolo).length;
        if (ls == 0 || ls > MAX_SIMBOLO) revert SimboloInvalido();
        if (supply == 0 || supply > MAX_SUPPLY) revert SupplyInvalido(supply);
        token = address(new TokenSimple(nombre, simbolo, dueno, supply));
        totalTokens++;
        _tokensDe[dueno].push(token);
        emit TokenCreado(token, dueno, nombre, simbolo, supply);
    }

    function tokensDe(address dueno) external view returns (address[] memory) {
        return _tokensDe[dueno];
    }
}
