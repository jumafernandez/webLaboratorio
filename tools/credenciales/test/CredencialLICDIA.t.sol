// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {CredencialLICDIA} from "../src/CredencialLICDIA.sol";

contract CredencialLICDIATest is Test {
    CredencialLICDIA c;
    address dueno = makeAddr("dueno");
    address ana = makeAddr("ana");
    address beto = makeAddr("beto");
    bytes32 acto = sha256("DISPSECADM-000/2027");

    function setUp() public {
        c = new CredencialLICDIA(dueno);
    }

    function _emitir(address a) internal returns (uint256) {
        vm.prank(dueno);
        return c.issue(a, 2026, 0, "Ana (seudonimo)", "Con distincion", acto);
    }

    // ---------------------------------------------------------------- issue

    function test_IssueGuardaDatos() public {
        vm.warp(1_800_000_000);
        uint256 id = _emitir(ana);
        assertEq(id, 1);
        assertEq(c.ownerOf(id), ana);
        assertEq(c.totalEmitidas(), 1);
        assertEq(c.credencialDe(ana, 2026, 0), id);
        (bool vigente, address titular, CredencialLICDIA.Credencial memory d) = c.verify(id);
        assertTrue(vigente);
        assertEq(titular, ana);
        assertEq(d.cohorte, 2026);
        assertEq(d.alcance, 0);
        assertEq(d.emitidaEn, 1_800_000_000);
        assertEq(d.actoHash, acto);
        assertEq(d.nombre, "Ana (seudonimo)");
        assertEq(d.mencion, "Con distincion");
        assertFalse(d.revocada);
    }

    function test_IssueEmiteEvento() public {
        vm.expectEmit(true, true, false, true);
        emit CredencialLICDIA.Emitida(1, ana, 2026, 0, acto, "Ana");
        vm.prank(dueno);
        c.issue(ana, 2026, 0, "Ana", "", acto);
    }

    function test_IssueDuplicadoRevierte() public {
        _emitir(ana);
        vm.prank(dueno);
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.YaEmitida.selector, ana, uint16(2026), uint8(0)));
        c.issue(ana, 2026, 0, "Ana", "", acto);
    }

    function test_IssueOtroAlcanceOCohorteSePermite() public {
        _emitir(ana);
        vm.startPrank(dueno);
        c.issue(ana, 2026, 1, "Ana", "", acto);
        c.issue(ana, 2027, 0, "Ana", "", acto);
        vm.stopPrank();
        assertEq(c.balanceOf(ana), 3);
        assertEq(c.tokenOfOwnerByIndex(ana, 2), 3);
    }

    function test_IssueValidaEntradas() public {
        vm.startPrank(dueno);
        vm.expectRevert(CredencialLICDIA.DireccionInvalida.selector);
        c.issue(address(0), 2026, 0, "Ana", "", acto);
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.AlcanceInvalido.selector, uint8(5)));
        c.issue(ana, 2026, 5, "Ana", "", acto);
        vm.expectRevert(CredencialLICDIA.TextoInvalido.selector);
        c.issue(ana, 2026, 0, "", "", acto);
        vm.expectRevert(CredencialLICDIA.TextoInvalido.selector);
        c.issue(ana, 2026, 0, "012345678901234567890123456789012345678901234567890", "", acto);
        vm.expectRevert(CredencialLICDIA.ActoVacio.selector);
        c.issue(ana, 2026, 0, "Ana", "", bytes32(0));
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- only owner

    function test_IssueSoloOwner() public {
        vm.prank(ana);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ana));
        c.issue(ana, 2026, 0, "Ana", "", acto);
    }

    function test_RevokeSoloOwner() public {
        uint256 id = _emitir(ana);
        vm.prank(ana);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ana));
        c.revoke(id, "x");
    }

    // ---------------------------------------------------------------- revoke

    function test_RevokeMarcaYConservaDatos() public {
        uint256 id = _emitir(ana);
        vm.expectEmit(true, false, false, true);
        emit CredencialLICDIA.Revocada(id, "Error de carga");
        vm.prank(dueno);
        c.revoke(id, "Error de carga");
        (bool vigente, address titular, CredencialLICDIA.Credencial memory d) = c.verify(id);
        assertFalse(vigente);
        assertEq(titular, ana);
        assertTrue(d.revocada);
        assertEq(d.motivoRevocacion, "Error de carga");
        assertEq(d.actoHash, acto);
        assertEq(c.ownerOf(id), ana);
    }

    function test_RevokeDosVecesRevierte() public {
        uint256 id = _emitir(ana);
        vm.startPrank(dueno);
        c.revoke(id, "a");
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.YaRevocada.selector, id));
        c.revoke(id, "b");
        vm.stopPrank();
    }

    function test_RevokeExigeMotivoYExistencia() public {
        uint256 id = _emitir(ana);
        vm.startPrank(dueno);
        vm.expectRevert(CredencialLICDIA.TextoInvalido.selector);
        c.revoke(id, "");
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 99));
        c.revoke(99, "x");
        vm.stopPrank();
    }

    function test_ReemisionTrasRevocacion() public {
        uint256 id = _emitir(ana);
        vm.prank(dueno);
        c.revoke(id, "Dato mal cargado");
        uint256 nuevo = _emitir(ana);
        assertEq(nuevo, 2);
        assertEq(c.credencialDe(ana, 2026, 0), 2);
        (bool vigenteViejo,,) = c.verify(id);
        (bool vigenteNuevo,,) = c.verify(nuevo);
        assertFalse(vigenteViejo);
        assertTrue(vigenteNuevo);
    }

    // ---------------------------------------------------------------- soulbound

    function test_NoSeTransfiere() public {
        uint256 id = _emitir(ana);
        vm.startPrank(ana);
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.Intransferible.selector, id));
        c.transferFrom(ana, beto, id);
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.Intransferible.selector, id));
        c.safeTransferFrom(ana, beto, id);
        vm.stopPrank();
        assertEq(c.ownerOf(id), ana);
    }

    function test_NoSeTransfiereNiElOwner() public {
        uint256 id = _emitir(ana);
        vm.prank(dueno);
        vm.expectRevert(abi.encodeWithSelector(CredencialLICDIA.Intransferible.selector, id));
        c.transferFrom(ana, beto, id);
    }

    function test_NoSeAprueba() public {
        uint256 id = _emitir(ana);
        vm.startPrank(ana);
        vm.expectRevert(CredencialLICDIA.AprobacionNoPermitida.selector);
        c.approve(beto, id);
        vm.expectRevert(CredencialLICDIA.AprobacionNoPermitida.selector);
        c.setApprovalForAll(beto, true);
        vm.stopPrank();
    }

    function test_LockedYInterfaz5192() public {
        uint256 id = _emitir(ana);
        assertTrue(c.locked(id));
        assertTrue(c.supportsInterface(0xb45a3c0e));
        assertTrue(c.supportsInterface(0x80ac58cd)); // ERC-721
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 7));
        c.locked(7);
    }

    // ---------------------------------------------------------------- verify / metadata

    function test_VerifyInexistenteRevierte() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 1));
        c.verify(1);
    }

    function test_TokenURIJsonYEstado() public {
        uint256 id = _emitir(ana);
        string memory uri = c.tokenURI(id);
        assertEq(_prefijo(uri, 29), "data:application/json;base64,");
        vm.prank(dueno);
        c.revoke(id, "motivo");
        assertTrue(keccak256(bytes(c.tokenURI(id))) != keccak256(bytes(uri)));
    }

    function test_NombreConXmlNoRompeElSvg() public {
        vm.prank(dueno);
        uint256 id = c.issue(ana, 2026, 0, "<b>&\"x'", "", acto);
        assertGt(bytes(c.tokenURI(id)).length, 100);
    }

    function _prefijo(string memory s, uint256 n) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory o = new bytes(n);
        for (uint256 i; i < n; i++) {
            o[i] = b[i];
        }
        return string(o);
    }
}
