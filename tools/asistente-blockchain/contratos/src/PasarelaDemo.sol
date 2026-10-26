// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ConRelayers} from "./ConRelayers.sol";
import {USDLDemo} from "./USDLDemo.sol";
import {InsigniasLICDIA} from "./InsigniasLICDIA.sol";

/// @notice Level 4: payment gateway. Mirrors the Curso 4 flow, but the relayer executes on behalf of the visitor.
contract PasarelaDemo is ConRelayers {
    uint256 public constant FONDEO = 100;
    uint256 public constant MAX_PRODUCTO = 24;

    USDLDemo public immutable usdl;
    InsigniasLICDIA public immutable insignias;
    address public immutable comercio;

    uint256 public totalPagos;
    mapping(address => bool) public fondeado;

    event Fondeado(address indexed v, uint256 monto);
    event PagoRecibido(uint256 indexed id, address indexed v, string producto, uint256 monto);

    error YaFondeado(address v);
    error ProductoInvalido();
    error MontoInvalido();

    constructor(USDLDemo usdl_, InsigniasLICDIA insignias_, address comercio_) {
        if (address(usdl_) == address(0) || address(insignias_) == address(0) || comercio_ == address(0)) {
            revert DireccionInvalida();
        }
        usdl = usdl_;
        insignias = insignias_;
        comercio = comercio_;
    }

    /// @notice Faucet: 100 USDL, once per address.
    function fondear(address v) external soloRelayer {
        if (v == address(0)) revert DireccionInvalida();
        if (fondeado[v]) revert YaFondeado(v);
        fondeado[v] = true;
        usdl.acunarPorPasarela(v, FONDEO * 1e18);
        emit Fondeado(v, FONDEO);
    }

    /// @param monto Whole USDL (scaled by 1e18 here).
    function pagarPor(address v, string calldata producto, uint256 monto)
        external
        soloRelayer
        returns (uint256 pagoId, uint256 reciboId)
    {
        if (v == address(0)) revert DireccionInvalida();
        uint256 lp = bytes(producto).length;
        if (lp == 0 || lp > MAX_PRODUCTO) revert ProductoInvalido();
        if (monto == 0) revert MontoInvalido();
        usdl.moverPorPasarela(v, comercio, monto * 1e18);
        pagoId = ++totalPagos;
        emit PagoRecibido(pagoId, v, producto, monto);
        reciboId = insignias.acunar(v, 7, producto);
    }
}
