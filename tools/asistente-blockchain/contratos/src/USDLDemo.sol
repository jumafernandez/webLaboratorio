// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Demo stablecoin: only the gateway can mint it and move it between accounts.
contract USDLDemo is ERC20, Ownable {
    address public pasarela;

    event PasarelaFijada(address indexed pasarela);

    error SoloPasarela(address cuenta);
    error PasarelaYaFijada();
    error DireccionInvalida();

    modifier onlyPasarela() {
        if (msg.sender != pasarela) revert SoloPasarela(msg.sender);
        _;
    }

    constructor() ERC20("USD LICDIA Demo", "USDL") Ownable(msg.sender) {}

    /// @notice One-time wiring, done by the deploy script.
    function setPasarela(address p) external onlyOwner {
        if (pasarela != address(0)) revert PasarelaYaFijada();
        if (p == address(0)) revert DireccionInvalida();
        pasarela = p;
        emit PasarelaFijada(p);
    }

    function acunarPorPasarela(address a, uint256 monto) external onlyPasarela {
        _mint(a, monto);
    }

    /// @dev Uses _transfer, so a short balance reverts with ERC20InsufficientBalance.
    function moverPorPasarela(address from, address to, uint256 monto) external onlyPasarela {
        _transfer(from, to, monto);
    }
}
