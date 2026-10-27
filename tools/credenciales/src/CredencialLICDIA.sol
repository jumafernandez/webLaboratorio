// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Official graduate credentials of the LICDIA (UNLu) Blockchain diploma, as soulbound ERC-721 tokens.
/// The chain holds a verifiable pointer, not the degree: the legal document is the UNLu act, whose SHA-256 hash is
/// stored in `actoHash`. Only the owner (the issuing authority) can issue and revoke. A revoked credential stays
/// on chain, flagged as revoked with a reason, so verification reflects its current status.
/// Personal data is kept to a minimum: `nombre` is free text (a pseudonym or an initials-style label is fine).
contract CredencialLICDIA is ERC721Enumerable, Ownable {
    using Strings for uint256;

    /// @dev alcance: 0 = full diploma; 1..4 = a single course (Curso 1..4).
    uint8 public constant ALCANCE_DIPLOMATURA = 0;
    uint8 public constant ULTIMO_CURSO = 4;
    uint256 public constant MAX_NOMBRE = 48;
    uint256 public constant MAX_MENCION = 48;
    uint256 public constant MAX_MOTIVO = 140;

    struct Credencial {
        uint16 cohorte; // year the cohort started, e.g. 2026
        uint8 alcance; // 0 = Diplomatura, 1..4 = Curso n
        uint64 emitidaEn; // block timestamp of issuance
        bool revocada;
        bytes32 actoHash; // SHA-256 of the official act (disposición / acta), computed off chain
        string nombre; // name or pseudonym shown on the credential
        string mencion; // optional honour or note, e.g. "Con distinción"; may be empty
        string motivoRevocacion; // empty unless revoked
    }

    uint256 public totalEmitidas;
    mapping(uint256 => Credencial) private _credenciales;
    /// @notice tokenId of the live credential for (holder, cohorte, alcance); 0 if none.
    mapping(address => mapping(uint16 => mapping(uint8 => uint256))) public credencialDe;

    /// @dev ERC-5192 (minimal soulbound): every token is locked from the moment it is minted.
    event Locked(uint256 tokenId);
    event Emitida(
        uint256 indexed tokenId, address indexed a, uint16 cohorte, uint8 alcance, bytes32 actoHash, string nombre
    );
    event Revocada(uint256 indexed tokenId, string motivo);

    error DireccionInvalida();
    error AlcanceInvalido(uint8 alcance);
    error TextoInvalido();
    error ActoVacio();
    error YaEmitida(address a, uint16 cohorte, uint8 alcance);
    error Intransferible(uint256 tokenId);
    error YaRevocada(uint256 tokenId);
    error AprobacionNoPermitida();

    constructor(address dueno) ERC721("Credencial LICDIA", "CLICDIA") Ownable(dueno) {}

    // ---------------------------------------------------------------- owner actions

    function issue(
        address to,
        uint16 cohorte,
        uint8 alcance,
        string calldata nombre,
        string calldata mencion,
        bytes32 actoHash
    ) external onlyOwner returns (uint256 tokenId) {
        if (to == address(0)) revert DireccionInvalida();
        if (alcance > ULTIMO_CURSO) revert AlcanceInvalido(alcance);
        if (bytes(nombre).length == 0 || bytes(nombre).length > MAX_NOMBRE || bytes(mencion).length > MAX_MENCION) {
            revert TextoInvalido();
        }
        if (actoHash == bytes32(0)) revert ActoVacio();
        uint256 previa = credencialDe[to][cohorte][alcance];
        if (previa != 0 && !_credenciales[previa].revocada) revert YaEmitida(to, cohorte, alcance);

        tokenId = ++totalEmitidas;
        _credenciales[tokenId] = Credencial({
            cohorte: cohorte,
            alcance: alcance,
            emitidaEn: uint64(block.timestamp),
            revocada: false,
            actoHash: actoHash,
            nombre: nombre,
            mencion: mencion,
            motivoRevocacion: ""
        });
        credencialDe[to][cohorte][alcance] = tokenId;
        _mint(to, tokenId);
        emit Locked(tokenId);
        emit Emitida(tokenId, to, cohorte, alcance, actoHash, nombre);
    }

    /// @notice Flags a credential as revoked. It is never erased: verification keeps showing it, with the reason.
    function revoke(uint256 tokenId, string calldata motivo) external onlyOwner {
        _requireOwned(tokenId);
        if (_credenciales[tokenId].revocada) revert YaRevocada(tokenId);
        if (bytes(motivo).length == 0 || bytes(motivo).length > MAX_MOTIVO) revert TextoInvalido();
        _credenciales[tokenId].revocada = true;
        _credenciales[tokenId].motivoRevocacion = motivo;
        emit Revocada(tokenId, motivo);
    }

    // ---------------------------------------------------------------- verification

    /// @notice Everything a verifier needs in one call. `vigente` is false for a revoked credential.
    function verify(uint256 tokenId) external view returns (bool vigente, address titular, Credencial memory datos) {
        titular = _requireOwned(tokenId);
        datos = _credenciales[tokenId];
        vigente = !datos.revocada;
    }

    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    // ---------------------------------------------------------------- soulbound

    /// @dev Only mints pass. No transfers and no burns, so a credential can only change by being revoked.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert Intransferible(tokenId);
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override(ERC721, IERC721) {
        revert AprobacionNoPermitida();
    }

    function setApprovalForAll(address, bool) public pure override(ERC721, IERC721) {
        revert AprobacionNoPermitida();
    }

    function supportsInterface(bytes4 id) public view override(ERC721Enumerable) returns (bool) {
        return id == 0xb45a3c0e || super.supportsInterface(id); // ERC-5192
    }

    // ---------------------------------------------------------------- metadata

    function _alcanceTexto(uint8 alcance) internal pure returns (string memory) {
        if (alcance == 0) return unicode"Diplomatura de Posgrado en Blockchain";
        if (alcance == 1) return "Curso 1 - Fundamentos";
        if (alcance == 2) return "Curso 2 - DeFi";
        if (alcance == 3) return "Curso 3 - Infraestructura";
        return "Curso 4 - DApps";
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Credencial memory c = _credenciales[tokenId];
        string memory json = string.concat(
            '{"name":"Credencial LICDIA #',
            tokenId.toString(),
            '","description":"',
            unicode"Credencial de la Diplomatura de Posgrado en Blockchain (LICDIA, UNLu). El documento oficial es el acto de la UNLu cuyo hash figura en los atributos.",
            '","attributes":',
            _atributos(c),
            ',"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(tokenId, c))),
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _atributos(Credencial memory c) internal pure returns (string memory) {
        return string.concat(
            '[{"trait_type":"Alcance","value":"',
            _alcanceTexto(c.alcance),
            '"},{"trait_type":"Cohorte","value":',
            uint256(c.cohorte).toString(),
            '},{"trait_type":"Estado","value":"',
            c.revocada ? "Revocada" : "Vigente",
            '"},{"trait_type":"Hash del acto","value":"',
            Strings.toHexString(uint256(c.actoHash), 32),
            '"}]'
        );
    }

    function _svg(uint256 tokenId, Credencial memory c) internal pure returns (string memory) {
        string memory borde = c.revocada ? "#b4442f" : "#c4a5ff";
        string memory cab = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" rx="14" fill="#140b2a" stroke="',
            borde,
            '" stroke-width="3"/><text x="24" y="44" fill="#c4a5ff" font-family="monospace" font-size="13">CREDENCIAL LICDIA #',
            tokenId.toString(),
            "</text>"
        );
        string memory cuerpo = string.concat(
            '<text x="24" y="100" fill="#fff" font-family="sans-serif" font-size="22">',
            _escapeXml(c.nombre),
            '</text><text x="24" y="136" fill="#e2d8f7" font-family="sans-serif" font-size="14">',
            _alcanceTexto(c.alcance),
            '</text><text x="24" y="162" fill="#e2d8f7" font-family="sans-serif" font-size="14">Cohorte ',
            uint256(c.cohorte).toString(),
            "</text>"
        );
        return string.concat(
            cab,
            cuerpo,
            '<text x="24" y="236" fill="',
            borde,
            '" font-family="monospace" font-size="13">',
            c.revocada ? "REVOCADA" : "VIGENTE",
            "</text></svg>"
        );
    }

    /// @dev Escapes the five XML special characters so a free-text name cannot break out of the SVG.
    function _escapeXml(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length * 6);
        uint256 n;
        for (uint256 i; i < b.length; i++) {
            bytes1 ch = b[i];
            bytes memory rep;
            if (ch == "<") rep = "&lt;";
            else if (ch == ">") rep = "&gt;";
            else if (ch == "&") rep = "&amp;";
            else if (ch == '"') rep = "&quot;";
            else if (ch == "'") rep = "&#39;";
            if (rep.length == 0) {
                out[n++] = ch;
            } else {
                for (uint256 j; j < rep.length; j++) {
                    out[n++] = rep[j];
                }
            }
        }
        bytes memory res = new bytes(n);
        for (uint256 k; k < n; k++) {
            res[k] = out[k];
        }
        return string(res);
    }
}
