// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Shared access control: the owner manages a set of relayers that act on behalf of visitors.
abstract contract ConRelayers is Ownable {
    mapping(address => bool) public relayers;

    event RelayerCambiado(address indexed relayer, bool habilitado);

    error NoEsRelayer(address cuenta);
    error DireccionInvalida();

    modifier soloRelayer() {
        if (!relayers[msg.sender]) revert NoEsRelayer(msg.sender);
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setRelayer(address relayer, bool habilitado) external onlyOwner {
        if (relayer == address(0)) revert DireccionInvalida();
        relayers[relayer] = habilitado;
        emit RelayerCambiado(relayer, habilitado);
    }
}
