// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ConRelayers} from "../src/ConRelayers.sol";
import {SelloLICDIA} from "../src/SelloLICDIA.sol";
import {InsigniasLICDIA} from "../src/InsigniasLICDIA.sol";
import {FabricaTokens, TokenSimple} from "../src/FabricaTokens.sol";
import {USDLDemo} from "../src/USDLDemo.sol";
import {PasarelaDemo} from "../src/PasarelaDemo.sol";
import {Base64Decode} from "./Base64Decode.sol";

contract ContratosTest is Test {
    SelloLICDIA sello;
    InsigniasLICDIA insignias;
    FabricaTokens fabrica;
    USDLDemo usdl;
    PasarelaDemo pasarela;

    address dueno = address(this);
    address relayer = makeAddr("relayer");
    address visitante = makeAddr("visitante");
    address otro = makeAddr("otro");
    address comercio = makeAddr("comercio");

    function setUp() public {
        sello = new SelloLICDIA();
        insignias = new InsigniasLICDIA();
        fabrica = new FabricaTokens();
        usdl = new USDLDemo();
        pasarela = new PasarelaDemo(usdl, insignias, comercio);
        usdl.setPasarela(address(pasarela));
        sello.setRelayer(relayer, true);
        insignias.setRelayer(relayer, true);
        insignias.setRelayer(address(pasarela), true);
        fabrica.setRelayer(relayer, true);
        pasarela.setRelayer(relayer, true);
    }

    // ------------------------------------------------------------ access control

    function test_SetRelayerSoloOwner() public {
        vm.prank(otro);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otro));
        sello.setRelayer(otro, true);
    }

    function test_SetRelayerDireccionCero() public {
        vm.expectRevert(ConRelayers.DireccionInvalida.selector);
        sello.setRelayer(address(0), true);
    }

    function test_SetRelayerEmiteYRevoca() public {
        vm.expectEmit(true, false, false, true);
        emit ConRelayers.RelayerCambiado(relayer, false);
        sello.setRelayer(relayer, false);
        assertFalse(sello.relayers(relayer));
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ConRelayers.NoEsRelayer.selector, relayer));
        sello.sellar(visitante, "hola");
    }

    function test_SoloRelayerEnTodasLasEscrituras() public {
        bytes memory err = abi.encodeWithSelector(ConRelayers.NoEsRelayer.selector, otro);
        vm.startPrank(otro);
        vm.expectRevert(err);
        sello.sellar(visitante, "hola");
        vm.expectRevert(err);
        insignias.acunar(visitante, 0, "");
        vm.expectRevert(err);
        fabrica.crear(visitante, "Mate", "MATE", 100);
        vm.expectRevert(err);
        pasarela.fondear(visitante);
        vm.expectRevert(err);
        pasarela.pagarPor(visitante, "cafe", 5);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ SelloLICDIA

    function test_Sellar() public {
        string memory m = unicode"Hola desde Luján";
        vm.expectEmit(true, true, false, true);
        emit SelloLICDIA.Sellado(1, visitante, keccak256(bytes(m)), m);
        vm.prank(relayer);
        uint256 id = sello.sellar(visitante, m);
        assertEq(id, 1);
        assertEq(sello.huella(1), keccak256(bytes(m)));
        assertEq(sello.autorDe(1), visitante);
        assertTrue(sello.verificar(1, m));
        assertFalse(sello.verificar(1, unicode"Hola desde Lujan"));
        assertFalse(sello.verificar(2, m));
        vm.prank(relayer);
        assertEq(sello.sellar(visitante, "otro"), 2);
    }

    function test_SellarLimites() public {
        vm.startPrank(relayer);
        vm.expectRevert(abi.encodeWithSelector(SelloLICDIA.MensajeInvalido.selector, 0));
        sello.sellar(visitante, "");
        string memory largo = _repetir("a", 121);
        vm.expectRevert(abi.encodeWithSelector(SelloLICDIA.MensajeInvalido.selector, 121));
        sello.sellar(visitante, largo);
        assertEq(sello.sellar(visitante, _repetir("a", 120)), 1);
        vm.expectRevert(ConRelayers.DireccionInvalida.selector);
        sello.sellar(address(0), "x");
        vm.stopPrank();
    }

    // ------------------------------------------------------------ InsigniasLICDIA

    function test_AcunarInsignia() public {
        vm.expectEmit(true, true, false, true);
        emit InsigniasLICDIA.Acunada(1, visitante, 0, "");
        vm.prank(relayer);
        uint256 id = insignias.acunar(visitante, 0, "");
        assertEq(id, 1);
        assertEq(insignias.ownerOf(1), visitante);
        assertEq(insignias.tipoDe(1), 0);
        assertTrue(insignias.tieneInsignia(visitante, 0));
        assertFalse(insignias.tieneInsignia(visitante, 1));
        assertEq(insignias.insigniaDe(visitante, 0), 1);
        assertEq(insignias.name(), "Insignias LICDIA");
        assertEq(insignias.symbol(), "LICDIA");
    }

    function test_InsigniaDuplicadaRevierte() public {
        vm.startPrank(relayer);
        for (uint8 t = 0; t <= 6; t++) {
            insignias.acunar(visitante, t, t == 4 ? "Mi NFT" : "");
            vm.expectRevert(abi.encodeWithSelector(InsigniasLICDIA.YaTieneInsignia.selector, visitante, t));
            insignias.acunar(visitante, t, t == 4 ? "Otro" : "");
        }
        // other addresses can still get them
        insignias.acunar(otro, 0, "");
        // receipts are unlimited
        insignias.acunar(visitante, 7, "cafe");
        insignias.acunar(visitante, 7, "cafe");
        vm.stopPrank();
        assertEq(insignias.balanceOf(visitante), 9);
    }

    function test_AcunarLimites() public {
        vm.startPrank(relayer);
        vm.expectRevert(abi.encodeWithSelector(InsigniasLICDIA.TipoInvalido.selector, 8));
        insignias.acunar(visitante, 8, "x");
        vm.expectRevert(InsigniasLICDIA.NombreInvalido.selector);
        insignias.acunar(visitante, 4, "");
        vm.expectRevert(InsigniasLICDIA.NombreInvalido.selector);
        insignias.acunar(visitante, 7, "");
        vm.expectRevert(InsigniasLICDIA.NombreInvalido.selector);
        insignias.acunar(visitante, 4, _repetir("n", 25));
        insignias.acunar(visitante, 4, _repetir("n", 24));
        vm.expectRevert(ConRelayers.DireccionInvalida.selector);
        insignias.acunar(address(0), 0, "");
        vm.stopPrank();
    }

    function test_InsigniasSonIntransferibles() public {
        vm.startPrank(relayer);
        for (uint8 t = 0; t <= 6; t++) {
            insignias.acunar(visitante, t, "x");
        }
        vm.stopPrank();
        vm.startPrank(visitante);
        for (uint256 id = 1; id <= 7; id++) {
            assertFalse(insignias.esTransferible(id));
            vm.expectRevert(abi.encodeWithSelector(InsigniasLICDIA.Intransferible.selector, id));
            insignias.transferFrom(visitante, otro, id);
            vm.expectRevert(abi.encodeWithSelector(InsigniasLICDIA.Intransferible.selector, id));
            insignias.safeTransferFrom(visitante, otro, id);
        }
        // approved operator cannot move them either
        insignias.setApprovalForAll(otro, true);
        vm.stopPrank();
        vm.prank(otro);
        vm.expectRevert(abi.encodeWithSelector(InsigniasLICDIA.Intransferible.selector, 1));
        insignias.transferFrom(visitante, otro, 1);
        assertEq(insignias.ownerOf(1), visitante);
    }

    function test_CertificadoExigeLasCuatroInsignias() public {
        vm.startPrank(relayer);
        vm.expectRevert(abi.encodeWithSelector(InsigniasLICDIA.FaltanInsignias.selector, visitante));
        insignias.acunar(visitante, 6, "");
        for (uint8 t = 0; t < 3; t++) {
            insignias.acunar(visitante, t, "");
        }
        insignias.acunar(visitante, 4, "Mi NFT");
        insignias.acunar(visitante, 5, "");
        vm.expectRevert(abi.encodeWithSelector(InsigniasLICDIA.FaltanInsignias.selector, visitante));
        insignias.acunar(visitante, 6, "");
        insignias.acunar(visitante, 3, "");
        uint256 id = insignias.acunar(visitante, 6, "");
        vm.stopPrank();
        assertEq(insignias.ownerOf(id), visitante);
    }

    function test_DuenoQuemaSuInsignia() public {
        vm.prank(relayer);
        uint256 id = insignias.acunar(visitante, 4, "ESTAFADOR");
        // only the owner: not a third party, not an approved operator, not the relayer
        vm.prank(otro);
        vm.expectRevert(abi.encodeWithSelector(InsigniasLICDIA.NoEsDueno.selector, id));
        insignias.quemar(id);
        vm.prank(visitante);
        insignias.setApprovalForAll(otro, true);
        vm.prank(otro);
        vm.expectRevert(abi.encodeWithSelector(InsigniasLICDIA.NoEsDueno.selector, id));
        insignias.quemar(id);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(InsigniasLICDIA.NoEsDueno.selector, id));
        insignias.quemar(id);
        vm.prank(visitante);
        insignias.quemar(id);
        assertFalse(insignias.tieneInsignia(visitante, 4));
        assertEq(insignias.balanceOf(visitante), 0);
        // the slot is free again
        vm.prank(relayer);
        uint256 nuevo = insignias.acunar(visitante, 4, "Mi NFT");
        assertEq(insignias.nombreDe(nuevo), "Mi NFT");
        vm.expectRevert();
        insignias.ownerOf(id);
    }

    function test_ReciboEsTransferible() public {
        vm.prank(relayer);
        uint256 id = insignias.acunar(visitante, 7, "apunte");
        assertTrue(insignias.esTransferible(id));
        vm.prank(visitante);
        insignias.transferFrom(visitante, otro, id);
        assertEq(insignias.ownerOf(id), otro);
    }

    function test_TokenURIDeTodosLosTipos() public {
        vm.startPrank(relayer);
        for (uint8 t = 0; t <= 7; t++) {
            insignias.acunar(visitante, t, t == 4 ? "Mi gato" : (t == 7 ? "cafe" : ""));
        }
        vm.stopPrank();
        string[8] memory nombres = [
            "Insignia Curso 1 - Fundamentos",
            "Insignia Curso 2 - DeFi",
            "Insignia Curso 3 - Infraestructura",
            "Insignia Curso 4 - DApps",
            "Mi gato",
            unicode"Bonus - Hackeá un contrato",
            "Certificado del recorrido",
            "Recibo #8 - cafe"
        ];
        for (uint256 id = 1; id <= 8; id++) {
            string memory json = _json(id);
            assertEq(vm.parseJsonString(json, ".name"), nombres[id - 1]);
            assertGt(bytes(vm.parseJsonString(json, ".description")).length, 10);
            assertEq(vm.parseJsonString(json, ".attributes[0].trait_type"), "Tipo");
            assertEq(vm.parseJsonString(json, ".attributes[1].value"), id == 8 ? "Si" : "No");
            string memory svg = _svg(json);
            assertTrue(_empiezaCon(svg, "<svg xmlns=\"http://www.w3.org/2000/svg\""));
            assertTrue(_terminaCon(svg, "</svg>"));
            assertTrue(_contiene(svg, "#261951") && _contiene(svg, "#ffd782"));
        }
        assertEq(vm.parseJsonUint(_json(2), ".attributes[2].value"), 2);
        assertEq(vm.parseJsonString(_json(8), ".attributes[2].value"), "cafe");
    }

    function test_TokenURIEscapaNombre() public {
        vm.prank(relayer);
        uint256 id = insignias.acunar(visitante, 4, "<b>\"hola\"</b> & 'yo'");
        string memory json = _json(id);
        assertEq(vm.parseJsonString(json, ".name"), "<b>\"hola\"</b> & 'yo'");
        string memory svg = _svg(json);
        assertTrue(_contiene(svg, "&lt;b&gt;&quot;hola&quot;&lt;/b&gt; &amp; &#39;yo&#39;"));
        assertFalse(_contiene(svg, "<b>"));
        assertTrue(_contiene(svg, "<circle"));
    }

    function test_TokenURIInexistenteRevierte() public {
        vm.expectRevert();
        insignias.tokenURI(99);
    }

    // ------------------------------------------------------------ FabricaTokens

    function test_CrearToken() public {
        vm.prank(relayer);
        address t = fabrica.crear(visitante, "Mate Coin", "MATE", 1000);
        TokenSimple token = TokenSimple(t);
        assertEq(token.name(), "Mate Coin");
        assertEq(token.symbol(), "MATE");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1000e18);
        assertEq(token.balanceOf(visitante), 1000e18);
        assertEq(fabrica.totalTokens(), 1);
        assertEq(fabrica.tokensDe(visitante)[0], t);
        // the visitor really owns it
        vm.prank(visitante);
        token.transfer(otro, 1e18);
        assertEq(token.balanceOf(otro), 1e18);
    }

    function test_CrearTokenEmite() public {
        vm.recordLogs();
        vm.prank(relayer);
        address t = fabrica.crear(visitante, "Mate Coin", "MATE", 21_000_000);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        Vm.Log memory ultimo = logs[logs.length - 1];
        assertEq(ultimo.topics[0], FabricaTokens.TokenCreado.selector);
        assertEq(address(uint160(uint256(ultimo.topics[1]))), t);
        assertEq(address(uint160(uint256(ultimo.topics[2]))), visitante);
        (string memory n, string memory s, uint256 supply) = abi.decode(ultimo.data, (string, string, uint256));
        assertEq(n, "Mate Coin");
        assertEq(s, "MATE");
        assertEq(supply, 21_000_000);
    }

    function test_CrearTokenLimites() public {
        vm.startPrank(relayer);
        vm.expectRevert(FabricaTokens.NombreInvalido.selector);
        fabrica.crear(visitante, "", "X", 1);
        vm.expectRevert(FabricaTokens.NombreInvalido.selector);
        fabrica.crear(visitante, _repetir("n", 25), "X", 1);
        vm.expectRevert(FabricaTokens.SimboloInvalido.selector);
        fabrica.crear(visitante, "Nombre", "", 1);
        vm.expectRevert(FabricaTokens.SimboloInvalido.selector);
        fabrica.crear(visitante, "Nombre", "SEISSS", 1);
        vm.expectRevert(abi.encodeWithSelector(FabricaTokens.SupplyInvalido.selector, 0));
        fabrica.crear(visitante, "Nombre", "X", 0);
        vm.expectRevert(abi.encodeWithSelector(FabricaTokens.SupplyInvalido.selector, 21_000_001));
        fabrica.crear(visitante, "Nombre", "X", 21_000_001);
        vm.expectRevert(ConRelayers.DireccionInvalida.selector);
        fabrica.crear(address(0), "Nombre", "X", 1);
        fabrica.crear(visitante, _repetir("n", 24), "CINCO", 21_000_000);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ USDLDemo

    function test_USDLMetadatos() public view {
        assertEq(usdl.name(), "USD LICDIA Demo");
        assertEq(usdl.symbol(), "USDL");
        assertEq(usdl.decimals(), 18);
        assertEq(usdl.pasarela(), address(pasarela));
    }

    function test_USDLSoloPasarela() public {
        vm.startPrank(relayer);
        vm.expectRevert(abi.encodeWithSelector(USDLDemo.SoloPasarela.selector, relayer));
        usdl.acunarPorPasarela(visitante, 1);
        vm.expectRevert(abi.encodeWithSelector(USDLDemo.SoloPasarela.selector, relayer));
        usdl.moverPorPasarela(visitante, otro, 1);
        vm.stopPrank();
    }

    function test_USDLSetPasarelaUnaVez() public {
        vm.expectRevert(USDLDemo.PasarelaYaFijada.selector);
        usdl.setPasarela(otro);
        USDLDemo nuevo = new USDLDemo();
        vm.expectRevert(USDLDemo.DireccionInvalida.selector);
        nuevo.setPasarela(address(0));
        vm.prank(otro);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otro));
        nuevo.setPasarela(otro);
    }

    // ------------------------------------------------------------ PasarelaDemo

    function test_Fondear() public {
        vm.expectEmit(true, false, false, true);
        emit PasarelaDemo.Fondeado(visitante, 100);
        vm.prank(relayer);
        pasarela.fondear(visitante);
        assertEq(usdl.balanceOf(visitante), 100e18);
        assertTrue(pasarela.fondeado(visitante));
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PasarelaDemo.YaFondeado.selector, visitante));
        pasarela.fondear(visitante);
        vm.prank(relayer);
        vm.expectRevert(ConRelayers.DireccionInvalida.selector);
        pasarela.fondear(address(0));
    }

    function test_PagarPor() public {
        vm.startPrank(relayer);
        pasarela.fondear(visitante);
        vm.expectEmit(true, true, false, true, address(pasarela));
        emit PasarelaDemo.PagoRecibido(1, visitante, "apunte", 15);
        vm.expectEmit(true, true, false, true, address(insignias));
        emit InsigniasLICDIA.Acunada(1, visitante, 7, "apunte");
        (uint256 pagoId, uint256 reciboId) = pasarela.pagarPor(visitante, "apunte", 15);
        vm.stopPrank();
        assertEq(pagoId, 1);
        assertEq(reciboId, 1);
        assertEq(usdl.balanceOf(visitante), 85e18);
        assertEq(usdl.balanceOf(comercio), 15e18);
        assertEq(insignias.ownerOf(reciboId), visitante);
        assertEq(insignias.tipoDe(reciboId), 7);
        assertEq(insignias.nombreDe(reciboId), "apunte");
        assertEq(pasarela.totalPagos(), 1);
    }

    function test_PagarSinSaldoRevierte() public {
        vm.startPrank(relayer);
        pasarela.fondear(visitante);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, visitante, 100e18, 500e18)
        );
        pasarela.pagarPor(visitante, "auto", 500);
        // not funded at all
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, otro, 0, 5e18));
        pasarela.pagarPor(otro, "cafe", 5);
        vm.stopPrank();
        assertEq(usdl.balanceOf(visitante), 100e18);
        assertEq(pasarela.totalPagos(), 0);
        assertEq(insignias.totalAcunadas(), 0);
    }

    function test_PagarLimites() public {
        vm.startPrank(relayer);
        pasarela.fondear(visitante);
        vm.expectRevert(PasarelaDemo.ProductoInvalido.selector);
        pasarela.pagarPor(visitante, "", 5);
        vm.expectRevert(PasarelaDemo.ProductoInvalido.selector);
        pasarela.pagarPor(visitante, _repetir("p", 25), 5);
        vm.expectRevert(PasarelaDemo.MontoInvalido.selector);
        pasarela.pagarPor(visitante, "cafe", 0);
        vm.expectRevert(ConRelayers.DireccionInvalida.selector);
        pasarela.pagarPor(address(0), "cafe", 5);
        vm.stopPrank();
    }

    function test_PasarelaSinPermisoEnInsigniasRevierte() public {
        insignias.setRelayer(address(pasarela), false);
        vm.startPrank(relayer);
        pasarela.fondear(visitante);
        vm.expectRevert(abi.encodeWithSelector(ConRelayers.NoEsRelayer.selector, address(pasarela)));
        pasarela.pagarPor(visitante, "cafe", 5);
        vm.stopPrank();
        assertEq(usdl.balanceOf(visitante), 100e18); // the whole payment rolled back
    }

    function test_PasarelaConstructorValida() public {
        vm.expectRevert(ConRelayers.DireccionInvalida.selector);
        new PasarelaDemo(usdl, insignias, address(0));
    }

    function testFuzz_SellarCualquierLargoValido(uint8 n) public {
        uint256 largo = bound(n, 1, 120);
        vm.prank(relayer);
        uint256 id = sello.sellar(visitante, _repetir("z", largo));
        assertEq(sello.huella(id), keccak256(bytes(_repetir("z", largo))));
    }

    // ------------------------------------------------------------ helpers

    function _json(uint256 id) internal view returns (string memory) {
        string memory uri = insignias.tokenURI(id);
        string memory prefijo = "data:application/json;base64,";
        assertTrue(_empiezaCon(uri, prefijo));
        string memory json = string(Base64Decode.decode(_desde(uri, bytes(prefijo).length)));
        vm.parseJson(json); // reverts on invalid JSON
        return json;
    }

    function _svg(string memory json) internal pure returns (string memory) {
        string memory img = vm.parseJsonString(json, ".image");
        string memory prefijo = "data:image/svg+xml;base64,";
        require(_empiezaCon(img, prefijo), "image prefix");
        return string(Base64Decode.decode(_desde(img, bytes(prefijo).length)));
    }

    function _repetir(string memory c, uint256 n) internal pure returns (string memory s) {
        bytes memory b = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            b[i] = bytes(c)[0];
        }
        s = string(b);
    }

    function _desde(string memory s, uint256 i) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length - i);
        for (uint256 k = 0; k < out.length; k++) {
            out[k] = b[i + k];
        }
        return string(out);
    }

    function _empiezaCon(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(p);
        if (b.length > a.length) return false;
        for (uint256 i = 0; i < b.length; i++) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    function _terminaCon(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(p);
        if (b.length > a.length) return false;
        for (uint256 i = 0; i < b.length; i++) {
            if (a[a.length - b.length + i] != b[i]) return false;
        }
        return true;
    }

    function _contiene(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(p);
        if (b.length > a.length) return false;
        for (uint256 i = 0; i + b.length <= a.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < b.length; j++) {
                if (a[i + j] != b[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
