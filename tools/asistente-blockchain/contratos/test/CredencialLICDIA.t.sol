// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import {IERC721Metadata} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import {CredencialLICDIA} from "../src/CredencialLICDIA.sol";
import {Base64Decode} from "./Base64Decode.sol";

contract CredencialLICDIATest is Test {
    CredencialLICDIA c;
    address admin = address(this);
    address emisor = makeAddr("emisor");
    address ana = makeAddr("ana");
    address beto = makeAddr("beto");
    address otro = makeAddr("otro");
    bytes32 acto = sha256("DISPSECADM-000/2027");
    bytes32 EMISOR;

    function setUp() public {
        c = new CredencialLICDIA(admin);
        EMISOR = c.EMISOR_ROLE();
        c.grantRole(EMISOR, emisor);
    }

    function _emitir(address a, uint8 alcance) internal returns (uint256) {
        vm.prank(emisor);
        return c.emitir(a, 2026, alcance, acto, unicode"Ana Pérez", unicode"Con distinción");
    }

    // ---------------------------------------------------------------- emission

    function test_EmitirGuardaDatos() public {
        vm.warp(1_800_000_000);
        uint256 id = _emitir(ana, 0);
        assertEq(id, 1);
        assertEq(c.ownerOf(id), ana);
        assertEq(c.balanceOf(ana), 1);
        assertEq(c.totalEmitidas(), 1);
        assertEq(c.credencialDe(ana, 2026, 0), id);
        assertEq(c.name(), "Credencial LICDIA");
        assertEq(c.symbol(), "CLICDIA");
    }

    function test_EmitirEventos() public {
        vm.expectEmit(true, true, true, true);
        emit IERC721.Transfer(address(0), ana, 1);
        vm.expectEmit(false, false, false, true);
        emit CredencialLICDIA.Locked(1);
        vm.expectEmit(true, true, false, true);
        emit CredencialLICDIA.Emitida(1, ana, 2026, 3, acto, "Ana");
        vm.prank(emisor);
        c.emitir(ana, 2026, 3, acto, "Ana", "");
    }

    function test_EmitirLote() public {
        CredencialLICDIA.Emision[] memory lote = new CredencialLICDIA.Emision[](3);
        lote[0] = CredencialLICDIA.Emision(ana, 0, acto, "Ana", "");
        lote[1] = CredencialLICDIA.Emision(beto, 0, acto, "Beto", "Con honores");
        lote[2] = CredencialLICDIA.Emision(ana, 2, sha256("otro acto"), "Ana", "");
        vm.prank(emisor);
        uint256 primero = c.emitirLote(2026, lote);
        assertEq(primero, 1);
        assertEq(c.totalEmitidas(), 3);
        assertEq(c.balanceOf(ana), 2);
        assertEq(c.ownerOf(2), beto);
        (,, CredencialLICDIA.Datos memory d) = c.verify(2);
        assertEq(d.mencion, "Con honores");
        assertEq(d.cohorte, 2026);
    }

    function test_EmitirLoteEsTodoONada() public {
        CredencialLICDIA.Emision[] memory lote = new CredencialLICDIA.Emision[](2);
        lote[0] = CredencialLICDIA.Emision(ana, 0, acto, "Ana", "");
        lote[1] = CredencialLICDIA.Emision(ana, 0, acto, "Ana", ""); // duplicate inside the batch
        vm.prank(emisor);
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.YaEmitida.selector, ana, uint16(2026), uint8(0)));
        c.emitirLote(2026, lote);
        assertEq(c.totalEmitidas(), 0);
    }

    function test_EmitirLoteLimites() public {
        vm.startPrank(emisor);
        vm.expectRevert(CredencialLICDIA.LoteInvalido.selector);
        c.emitirLote(2026, new CredencialLICDIA.Emision[](0));
        vm.expectRevert(CredencialLICDIA.LoteInvalido.selector);
        c.emitirLote(2026, new CredencialLICDIA.Emision[](51));
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- roles

    function test_SoloEmisorEmite() public {
        bytes memory err =
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, otro, EMISOR);
        vm.startPrank(otro);
        vm.expectRevert(err);
        c.emitir(ana, 2026, 0, acto, "Ana", "");
        vm.expectRevert(err);
        c.emitirLote(2026, new CredencialLICDIA.Emision[](1));
        vm.stopPrank();
        uint256 id = _emitir(ana, 0);
        vm.prank(otro);
        vm.expectRevert(err);
        c.revocar(id, "fraude");
    }

    function test_AdminInicialYGestionDeRoles() public {
        assertTrue(c.hasRole(c.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(c.hasRole(EMISOR, admin));
        // a non-admin cannot grant the issuer role
        bytes32 adminRole = c.DEFAULT_ADMIN_ROLE();
        vm.prank(otro);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, otro, adminRole)
        );
        c.grantRole(EMISOR, otro);
        // the admin revokes an issuer, which can no longer emit
        c.revokeRole(EMISOR, emisor);
        vm.prank(emisor);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, emisor, EMISOR)
        );
        c.emitir(ana, 2026, 0, acto, "Ana", "");
    }

    function test_ConstructorAdminCero() public {
        vm.expectRevert(CredencialLICDIA.DireccionInvalida.selector);
        new CredencialLICDIA(address(0));
    }

    // ---------------------------------------------------------------- validation

    function test_DuplicadoRevierte() public {
        _emitir(ana, 0);
        bytes32 otroActo = sha256("otro"); // computed before expectRevert: sha256 is a precompile call
        vm.prank(emisor);
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.YaEmitida.selector, ana, uint16(2026), uint8(0)));
        c.emitir(ana, 2026, 0, otroActo, "Ana", "");
    }

    function test_OtroAlcanceOCohorteOTitularSePermite() public {
        _emitir(ana, 0);
        vm.startPrank(emisor);
        c.emitir(ana, 2026, 1, acto, "Ana", "");
        c.emitir(ana, 2027, 0, acto, "Ana", "");
        c.emitir(beto, 2026, 0, acto, "Beto", "");
        vm.stopPrank();
        assertEq(c.balanceOf(ana), 3);
        assertEq(c.totalEmitidas(), 4);
    }

    function test_AlcanceFueraDeRango() public {
        for (uint8 a = 0; a <= 4; a++) {
            _emitir(ana, a);
        }
        vm.prank(emisor);
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.AlcanceInvalido.selector, uint8(5)));
        c.emitir(beto, 2026, 5, acto, "Beto", "");
    }

    function test_ValidaEntradas() public {
        string memory largo = "01234567890123456789012345678901234567890123456789012345678901234"; // 65 bytes
        vm.startPrank(emisor);
        vm.expectRevert(CredencialLICDIA.DireccionInvalida.selector);
        c.emitir(address(0), 2026, 0, acto, "Ana", "");
        vm.expectRevert(CredencialLICDIA.NombreInvalido.selector);
        c.emitir(ana, 2026, 0, acto, "", "");
        vm.expectRevert(CredencialLICDIA.NombreInvalido.selector);
        c.emitir(ana, 2026, 0, acto, largo, "");
        vm.expectRevert(CredencialLICDIA.MencionInvalida.selector);
        c.emitir(ana, 2026, 0, acto, "Ana", largo);
        vm.expectRevert(CredencialLICDIA.ActoVacio.selector);
        c.emitir(ana, 2026, 0, bytes32(0), "Ana", "");
        // exactly MAX_NOMBRE bytes is fine
        c.emitir(ana, 2026, 0, acto, "0123456789012345678901234567890123456789012345678901234567890123", "");
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- soulbound / ERC-5192

    function test_TransferenciaRevierte() public {
        uint256 id = _emitir(ana, 0);
        vm.startPrank(ana);
        vm.expectRevert(CredencialLICDIA.AprobacionNoPermitida.selector);
        c.approve(beto, id);
        vm.expectRevert(CredencialLICDIA.AprobacionNoPermitida.selector);
        c.setApprovalForAll(beto, true);
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.Intransferible.selector, id));
        c.transferFrom(ana, beto, id);
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.Intransferible.selector, id));
        c.safeTransferFrom(ana, beto, id);
        vm.stopPrank();
        // not even the admin can move it
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.Intransferible.selector, id));
        c.transferFrom(ana, beto, id);
        assertEq(c.ownerOf(id), ana);
    }

    function test_ERC5192() public {
        uint256 id = _emitir(ana, 0);
        assertTrue(c.locked(id));
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 99));
        c.locked(99);
        assertTrue(c.supportsInterface(0xb45a3c0e)); // ERC-5192
        assertTrue(c.supportsInterface(type(IERC721).interfaceId));
        assertTrue(c.supportsInterface(type(IERC721Metadata).interfaceId));
        assertTrue(c.supportsInterface(type(IERC721Enumerable).interfaceId));
        assertTrue(c.supportsInterface(type(IAccessControl).interfaceId));
        assertTrue(c.supportsInterface(0x01ffc9a7)); // ERC-165
        assertFalse(c.supportsInterface(0xffffffff));
    }

    // ---------------------------------------------------------------- revocation and verify

    function test_VerifyVigente() public {
        vm.warp(1_800_000_000);
        uint256 id = _emitir(ana, 0);
        (bool vigente, address titular, CredencialLICDIA.Datos memory d) = c.verify(id);
        assertTrue(vigente);
        assertEq(titular, ana);
        assertEq(d.cohorte, 2026);
        assertEq(d.alcance, 0);
        assertEq(d.emitidaEn, 1_800_000_000);
        assertFalse(d.revocada);
        assertEq(d.actoHash, acto);
        assertEq(d.nombre, unicode"Ana Pérez");
        assertEq(d.mencion, unicode"Con distinción");
        assertEq(d.motivoRevocacion, "");
    }

    function test_RevocarConservaDatos() public {
        uint256 id = _emitir(ana, 0);
        vm.expectEmit(true, false, false, true);
        emit CredencialLICDIA.Revocada(id, "Error en el acto");
        vm.prank(emisor);
        c.revocar(id, "Error en el acto");
        (bool vigente, address titular, CredencialLICDIA.Datos memory d) = c.verify(id);
        assertFalse(vigente);
        assertEq(titular, ana);
        assertTrue(d.revocada);
        assertEq(d.motivoRevocacion, "Error en el acto");
        assertEq(d.nombre, unicode"Ana Pérez");
        assertEq(c.ownerOf(id), ana);
        assertEq(c.balanceOf(ana), 1);
        assertTrue(c.locked(id));
    }

    function test_RevocarValidaciones() public {
        uint256 id = _emitir(ana, 0);
        vm.startPrank(emisor);
        vm.expectRevert(CredencialLICDIA.MotivoInvalido.selector);
        c.revocar(id, "");
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 7));
        c.revocar(7, "x");
        c.revocar(id, "x");
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.YaRevocada.selector, id));
        c.revocar(id, "otra vez");
        vm.stopPrank();
    }

    function test_ReemitirTrasRevocar() public {
        uint256 id = _emitir(ana, 0);
        vm.startPrank(emisor);
        c.revocar(id, "Nombre mal escrito");
        uint256 nuevo = c.emitir(ana, 2026, 0, acto, "Ana Perez", "");
        vm.stopPrank();
        assertEq(nuevo, 2);
        assertEq(c.credencialDe(ana, 2026, 0), 2);
        (bool vigenteViejo,,) = c.verify(id);
        (bool vigenteNuevo,,) = c.verify(nuevo);
        assertFalse(vigenteViejo);
        assertTrue(vigenteNuevo);
    }

    function test_VerifyInexistenteRevierte() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 1));
        c.verify(1);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 1));
        c.tokenURI(1);
    }

    // ---------------------------------------------------------------- metadata

    function _json(uint256 id) internal view returns (string memory) {
        string memory uri = c.tokenURI(id);
        string memory prefijo = "data:application/json;base64,";
        assertEq(_slice(uri, 0, bytes(prefijo).length), prefijo);
        return string(Base64Decode.decode(_slice(uri, bytes(prefijo).length, bytes(uri).length)));
    }

    function test_TokenURIDecodifica() public {
        vm.prank(emisor);
        uint256 id = c.emitir(ana, 2026, 2, acto, unicode"Ana \"<Pérez>\"", unicode"Con distinción");
        string memory json = _json(id);
        assertEq(vm.parseJsonString(json, ".name"), "Credencial LICDIA #1 - Curso 2 - DeFi");
        assertEq(vm.parseJsonString(json, ".attributes[0].value"), unicode"Ana \"<Pérez>\"");
        assertEq(vm.parseJsonString(json, ".attributes[1].value"), "Curso 2 - DeFi");
        assertEq(vm.parseJsonUint(json, ".attributes[2].value"), 2026);
        assertEq(vm.parseJsonString(json, ".attributes[3].value"), "Vigente");
        assertEq(vm.parseJsonString(json, ".attributes[4].value"), vm.toString(acto));
        assertEq(vm.parseJsonString(json, ".attributes[6].value"), unicode"Con distinción");
        string memory img = vm.parseJsonString(json, ".image");
        string memory pre = "data:image/svg+xml;base64,";
        assertEq(_slice(img, 0, bytes(pre).length), pre);
        string memory svg = string(Base64Decode.decode(_slice(img, bytes(pre).length, bytes(img).length)));
        assertTrue(vm.contains(svg, "Ana &quot;&lt;P"));
        assertFalse(vm.contains(svg, unicode"<Pérez>"));
        assertTrue(vm.contains(svg, "VIGENTE"));

        vm.prank(emisor);
        c.revocar(id, "baja");
        json = _json(id);
        assertEq(vm.parseJsonString(json, ".attributes[3].value"), "Revocada");
        img = vm.parseJsonString(json, ".image");
        svg = string(Base64Decode.decode(_slice(img, bytes(pre).length, bytes(img).length)));
        assertTrue(vm.contains(svg, "REVOCADA"));
    }

    function test_TokenURISinMencion() public {
        vm.prank(emisor);
        uint256 id = c.emitir(ana, 2026, 0, acto, "Ana", "");
        string memory json = _json(id);
        assertFalse(vm.keyExistsJson(json, ".attributes[6]"));
        assertEq(vm.parseJsonString(json, ".attributes[1].value"), "Diplomatura completa");
    }

    // ---------------------------------------------------------------- enumerable

    function test_Enumerable() public {
        _emitir(ana, 0);
        _emitir(beto, 0);
        _emitir(ana, 1);
        assertEq(c.totalSupply(), 3);
        assertEq(c.tokenOfOwnerByIndex(ana, 0), 1);
        assertEq(c.tokenOfOwnerByIndex(ana, 1), 3);
        assertEq(c.tokenOfOwnerByIndex(beto, 0), 2);
        assertEq(c.tokenByIndex(2), 3);
        vm.expectRevert(abi.encodeWithSelector(ERC721OutOfBoundsIndex.selector, ana, 2));
        c.tokenOfOwnerByIndex(ana, 2);
    }

    error ERC721OutOfBoundsIndex(address owner, uint256 index);

    // ---------------------------------------------------------------- fuzz

    function testFuzz_Emitir(address a, uint16 cohorte, uint8 alcance, bytes32 h, string calldata nombre) public {
        uint256 largo = bytes(nombre).length;
        bytes memory err;
        if (a == address(0)) err = abi.encodeWithSelector(CredencialLICDIA.DireccionInvalida.selector);
        else if (alcance > 4) err = abi.encodeWithSelector(CredencialLICDIA.AlcanceInvalido.selector, alcance);
        else if (largo == 0 || largo > 64) err = abi.encodeWithSelector(CredencialLICDIA.NombreInvalido.selector);
        else if (h == bytes32(0)) err = abi.encodeWithSelector(CredencialLICDIA.ActoVacio.selector);

        vm.startPrank(emisor);
        if (err.length > 0) {
            vm.expectRevert(err);
            c.emitir(a, cohorte, alcance, h, nombre, "");
            assertEq(c.totalEmitidas(), 0);
            return;
        }
        uint256 id = c.emitir(a, cohorte, alcance, h, nombre, "");
        (bool vigente, address titular, CredencialLICDIA.Datos memory d) = c.verify(id);
        assertTrue(vigente);
        assertEq(titular, a);
        assertEq(d.cohorte, cohorte);
        assertEq(d.alcance, alcance);
        assertEq(d.actoHash, h);
        assertEq(d.nombre, nombre);
        assertEq(c.credencialDe(a, cohorte, alcance), id);
        assertTrue(c.locked(id));
        // metadata stays valid JSON whatever the (escaped) name is
        assertEq(vm.parseJsonString(_json(id), ".attributes[0].value"), nombre);
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.YaEmitida.selector, a, cohorte, alcance));
        c.emitir(a, cohorte, alcance, h, nombre, "");
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _slice(string memory s, uint256 desde, uint256 hasta) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(hasta - desde);
        for (uint256 i = desde; i < hasta; i++) {
            out[i - desde] = b[i];
        }
        return string(out);
    }
}
