// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Official credentials of the "Diplomatura de Posgrado en Blockchain" (LICDIA, UNLu) as soulbound ERC-721
/// tokens (ERC-5192). The chain holds a verifiable pointer, not the degree: the legal document is the UNLu act, whose
/// SHA-256 hash is stored in `actoHash`. Only accounts with EMISOR_ROLE (the university) can issue and revoke.
/// A revoked credential is never erased: it stays on chain flagged as revoked, with the reason.
/// alcance: 0 = Diplomatura completa, 1..4 = Curso 1..4.
/// Personal data is kept to a minimum: only the name the graduate agreed to publish (no ID number, e-mail, file id).
/// The read interface (verify, tokenURI, tokenOfOwnerByIndex, totalEmitidas, events) is fixed by js/bc-verificar.js.
contract CredencialLICDIA is ERC721Enumerable, AccessControl {
    using Strings for uint256;

    bytes32 public constant EMISOR_ROLE = keccak256("EMISOR_ROLE");
    uint8 public constant ALCANCE_DIPLOMATURA = 0;
    uint8 public constant ULTIMO_CURSO = 4;
    uint256 public constant MAX_NOMBRE = 64;
    uint256 public constant MAX_MENCION = 64;
    uint256 public constant MAX_MOTIVO = 140;
    uint256 public constant MAX_LOTE = 50;

    /// @dev Field order is part of the public ABI (verify) and must match ABI_CRED in js/bc-verificar.js.
    struct Datos {
        uint16 cohorte; // year the cohort started, e.g. 2026
        uint8 alcance; // 0 = Diplomatura completa, 1..4 = Curso n
        uint64 emitidaEn; // block timestamp of issuance
        bool revocada;
        bytes32 actoHash; // SHA-256 of the official act PDF, computed off chain
        string nombre; // name the graduate agreed to publish
        string mencion; // optional honour, e.g. "Con distinción"; may be empty
        string motivoRevocacion; // empty unless revoked
    }

    /// @notice One row of a batch issuance (emitirLote); the cohort is shared by the whole batch.
    struct Emision {
        address a;
        uint8 alcance;
        bytes32 actoHash;
        string nombre;
        string mencion;
    }

    uint256 public totalEmitidas;
    mapping(uint256 => Datos) private _datos;
    /// @notice tokenId of the live (or last revoked) credential for (holder, cohorte, alcance); 0 = none.
    mapping(address => mapping(uint16 => mapping(uint8 => uint256))) public credencialDe;

    /// @dev ERC-5192 (minimal soulbound): every token is locked from the moment it is minted.
    event Locked(uint256 tokenId);
    event Emitida(
        uint256 indexed tokenId, address indexed a, uint16 cohorte, uint8 alcance, bytes32 actoHash, string nombre
    );
    event Revocada(uint256 indexed tokenId, string motivo);

    error DireccionInvalida();
    error AlcanceInvalido(uint8 alcance);
    error NombreInvalido();
    error MencionInvalida();
    error MotivoInvalido();
    error ActoVacio();
    error YaEmitida(address a, uint16 cohorte, uint8 alcance);
    error YaRevocada(uint256 tokenId);
    error LoteInvalido();
    error Intransferible(uint256 tokenId);
    error AprobacionNoPermitida();

    /// @param admin Gets DEFAULT_ADMIN_ROLE (manages issuers) and EMISOR_ROLE.
    constructor(address admin) ERC721("Credencial LICDIA", "CLICDIA") {
        if (admin == address(0)) revert DireccionInvalida();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(EMISOR_ROLE, admin);
    }

    // ---------------------------------------------------------------- issuer actions

    /// @notice Issues one credential. Reverts if (a, cohorte, alcance) already has a live one; after a revocation the
    /// same holder can be issued a corrected credential (the revoked token stays visible).
    function emitir(
        address a,
        uint16 cohorte,
        uint8 alcance,
        bytes32 actoHash,
        string calldata nombre,
        string calldata mencion
    ) external onlyRole(EMISOR_ROLE) returns (uint256 tokenId) {
        return _emitir(a, cohorte, alcance, actoHash, nombre, mencion);
    }

    /// @notice Issues up to MAX_LOTE credentials of the same cohort in one transaction. All or nothing.
    function emitirLote(uint16 cohorte, Emision[] calldata lote)
        external
        onlyRole(EMISOR_ROLE)
        returns (uint256 primerId)
    {
        if (lote.length == 0 || lote.length > MAX_LOTE) revert LoteInvalido();
        primerId = totalEmitidas + 1;
        for (uint256 i = 0; i < lote.length; i++) {
            Emision calldata e = lote[i];
            _emitir(e.a, cohorte, e.alcance, e.actoHash, e.nombre, e.mencion);
        }
    }

    /// @notice Flags a credential as revoked. Nothing is erased: verify() keeps returning it with vigente = false.
    function revocar(uint256 tokenId, string calldata motivo) external onlyRole(EMISOR_ROLE) {
        _requireOwned(tokenId);
        if (_datos[tokenId].revocada) revert YaRevocada(tokenId);
        uint256 largo = bytes(motivo).length;
        if (largo == 0 || largo > MAX_MOTIVO) revert MotivoInvalido();
        _datos[tokenId].revocada = true;
        _datos[tokenId].motivoRevocacion = motivo;
        emit Revocada(tokenId, motivo);
    }

    function _emitir(
        address a,
        uint16 cohorte,
        uint8 alcance,
        bytes32 actoHash,
        string calldata nombre,
        string calldata mencion
    ) internal returns (uint256 tokenId) {
        if (a == address(0)) revert DireccionInvalida();
        if (alcance > ULTIMO_CURSO) revert AlcanceInvalido(alcance);
        uint256 largo = bytes(nombre).length;
        if (largo == 0 || largo > MAX_NOMBRE) revert NombreInvalido();
        if (bytes(mencion).length > MAX_MENCION) revert MencionInvalida();
        if (actoHash == bytes32(0)) revert ActoVacio();
        uint256 previa = credencialDe[a][cohorte][alcance];
        if (previa != 0 && !_datos[previa].revocada) revert YaEmitida(a, cohorte, alcance);

        tokenId = ++totalEmitidas;
        _datos[tokenId] = Datos({
            cohorte: cohorte,
            alcance: alcance,
            emitidaEn: uint64(block.timestamp),
            revocada: false,
            actoHash: actoHash,
            nombre: nombre,
            mencion: mencion,
            motivoRevocacion: ""
        });
        credencialDe[a][cohorte][alcance] = tokenId;
        _mint(a, tokenId);
        emit Locked(tokenId);
        emit Emitida(tokenId, a, cohorte, alcance, actoHash, nombre);
    }

    // ---------------------------------------------------------------- verification

    /// @notice Everything a verifier needs in one call. `vigente` is false for a revoked credential.
    function verify(uint256 tokenId) external view returns (bool vigente, address titular, Datos memory datos) {
        titular = _requireOwned(tokenId);
        datos = _datos[tokenId];
        vigente = !datos.revocada;
    }

    /// @notice ERC-5192: always true (every credential is soulbound). Reverts for a nonexistent token.
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    // ---------------------------------------------------------------- soulbound

    /// @dev Only mints pass: transfers revert and there is no burn, so a credential only changes by being revoked.
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

    function supportsInterface(bytes4 id) public view override(ERC721Enumerable, AccessControl) returns (bool) {
        return id == 0xb45a3c0e || super.supportsInterface(id); // 0xb45a3c0e = ERC-5192
    }

    // ---------------------------------------------------------------- metadata

    function _alcanceTexto(uint8 alcance) internal pure returns (string memory) {
        if (alcance == 0) return "Diplomatura completa";
        if (alcance == 1) return "Curso 1 - Fundamentos";
        if (alcance == 2) return "Curso 2 - DeFi";
        if (alcance == 3) return "Curso 3 - Infraestructura";
        return "Curso 4 - DApps";
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Datos memory d = _datos[tokenId];
        string memory json = string.concat(
            '{"name":"Credencial LICDIA #',
            tokenId.toString(),
            " - ",
            _alcanceTexto(d.alcance),
            '","description":"',
            unicode"Credencial oficial de la Diplomatura de Posgrado en Blockchain (LICDIA, UNLu). Intransferible. ",
            unicode"El documento oficial es el acto de la UNLu cuyo SHA-256 figura en los atributos.",
            '","attributes":',
            _atributos(d),
            ',"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(tokenId, d))),
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _atributos(Datos memory d) internal pure returns (string memory s) {
        s = string.concat(
            '[{"trait_type":"Nombre","value":"',
            Strings.escapeJSON(d.nombre),
            '"},{"trait_type":"Alcance","value":"',
            _alcanceTexto(d.alcance),
            '"},{"trait_type":"Cohorte","display_type":"number","value":',
            uint256(d.cohorte).toString(),
            '},{"trait_type":"Estado","value":"',
            d.revocada ? "Revocada" : "Vigente",
            '"},{"trait_type":"Hash del acto","value":"',
            Strings.toHexString(uint256(d.actoHash), 32),
            '"},{"trait_type":"Emitida","display_type":"date","value":',
            uint256(d.emitidaEn).toString(),
            "}"
        );
        if (bytes(d.mencion).length > 0) {
            s = string.concat(s, unicode',{"trait_type":"Mención","value":"', Strings.escapeJSON(d.mencion), '"}');
        }
        s = string.concat(s, "]");
    }

    function _svg(uint256 tokenId, Datos memory d) internal pure returns (string memory) {
        string memory borde = d.revocada ? "#e0715c" : "#ffd782";
        string memory cab = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" font-family="Helvetica,Arial,sans-serif">',
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#261951"/>',
            '<stop offset="1" stop-color="#4C1C7F"/></linearGradient></defs>',
            '<rect width="400" height="260" rx="18" fill="url(#g)"/><rect x="10" y="10" width="380" height="240" ',
            'rx="12" fill="none" stroke="',
            borde,
            '" stroke-width="2"/>',
            unicode'<text x="28" y="46" font-size="12" letter-spacing="3" fill="#c4b5fd">CREDENCIAL OFICIAL · LICDIA · UNLu</text>'
        );
        string memory cuerpo = string.concat(
            '<text x="28" y="104" font-size="22" font-weight="700" fill="#ffffff">',
            _escaparXML(d.nombre),
            '</text><text x="28" y="138" font-size="15" fill="#e2d8f7">',
            _alcanceTexto(d.alcance),
            '</text><text x="28" y="162" font-size="13" fill="#c4b5fd">Diplomatura de Posgrado en Blockchain - Cohorte ',
            uint256(d.cohorte).toString(),
            "</text>"
        );
        return string.concat(
            cab,
            cuerpo,
            '<text x="28" y="226" font-size="14" font-weight="700" fill="',
            borde,
            '">',
            d.revocada ? "REVOCADA" : "VIGENTE",
            '</text><text x="372" y="226" text-anchor="end" font-size="11" fill="#c4b5fd">#',
            tokenId.toString(),
            unicode" · intransferible</text></svg>"
        );
    }

    /// @dev Escapes the five XML special characters so a free-text name cannot break out of the SVG.
    function _escaparXML(string memory texto) internal pure returns (string memory) {
        bytes memory b = bytes(texto);
        bytes memory out;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "&") out = bytes.concat(out, "&amp;");
            else if (c == "<") out = bytes.concat(out, "&lt;");
            else if (c == ">") out = bytes.concat(out, "&gt;");
            else if (c == '"') out = bytes.concat(out, "&quot;");
            else if (c == "'") out = bytes.concat(out, "&#39;");
            else out = bytes.concat(out, c);
        }
        return string(out);
    }
}
