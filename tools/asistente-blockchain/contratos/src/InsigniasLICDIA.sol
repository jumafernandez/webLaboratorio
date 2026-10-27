// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ConRelayers} from "./ConRelayers.sol";

/// @notice Badges, bonus NFTs, the journey certificate and payment receipts, with fully on-chain metadata.
/// tipo: 0..3 = Curso 1..4 badge, 4 = bonus NFT, 5 = bonus hack, 6 = certificate, 7 = payment receipt.
/// Tipos 0..6 are soulbound and limited to one per address; receipts (7) are transferable and unlimited.
/// The certificate (6) needs the four course badges (0..3) first. Owners may burn their own tokens (quemar), which
/// frees the slot of a soulbound tipo so it can be minted again.
contract InsigniasLICDIA is ERC721, ConRelayers {
    using Strings for uint256;

    uint8 public constant TIPO_NFT = 4;
    uint8 public constant TIPO_CERTIFICADO = 6;
    uint8 public constant ULTIMO_INTRANSFERIBLE = 6;
    uint8 public constant TIPO_RECIBO = 7;
    uint256 public constant MAX_NOMBRE = 24;

    uint256 public totalAcunadas;
    mapping(uint256 => uint8) public tipoDe;
    mapping(uint256 => string) public nombreDe;
    /// @notice tokenId held by an address for a soulbound tipo (0 = none).
    mapping(address => mapping(uint8 => uint256)) public insigniaDe;

    event Acunada(uint256 indexed tokenId, address indexed a, uint8 tipo, string nombre);

    error TipoInvalido(uint8 tipo);
    error NombreInvalido();
    error YaTieneInsignia(address a, uint8 tipo);
    error Intransferible(uint256 tokenId);
    error FaltanInsignias(address a);
    error NoEsDueno(uint256 tokenId);

    constructor() ERC721("Insignias LICDIA", "LICDIA") {}

    function acunar(address a, uint8 tipo, string calldata nombre) external soloRelayer returns (uint256 tokenId) {
        if (a == address(0)) revert DireccionInvalida();
        if (tipo > TIPO_RECIBO) revert TipoInvalido(tipo);
        uint256 largo = bytes(nombre).length;
        if (largo > MAX_NOMBRE || (largo == 0 && (tipo == TIPO_NFT || tipo == TIPO_RECIBO))) revert NombreInvalido();
        if (tipo == TIPO_CERTIFICADO) {
            for (uint8 t = 0; t < 4; t++) {
                if (insigniaDe[a][t] == 0) revert FaltanInsignias(a);
            }
        }
        tokenId = ++totalAcunadas;
        if (tipo <= ULTIMO_INTRANSFERIBLE) {
            if (insigniaDe[a][tipo] != 0) revert YaTieneInsignia(a, tipo);
            insigniaDe[a][tipo] = tokenId;
        }
        tipoDe[tokenId] = tipo;
        nombreDe[tokenId] = nombre;
        _mint(a, tokenId);
        emit Acunada(tokenId, a, tipo, nombre);
    }

    /// @notice The owner burns one of their tokens (e.g. a badge minted to them by someone else).
    function quemar(uint256 tokenId) external {
        address dueno = _ownerOf(tokenId);
        if (dueno != msg.sender) revert NoEsDueno(tokenId);
        uint8 tipo = tipoDe[tokenId];
        if (tipo <= ULTIMO_INTRANSFERIBLE) delete insigniaDe[dueno][tipo];
        _burn(tokenId);
    }

    function tieneInsignia(address a, uint8 tipo) external view returns (bool) {
        return insigniaDe[a][tipo] != 0;
    }

    function esTransferible(uint256 tokenId) public view returns (bool) {
        return tipoDe[tokenId] > ULTIMO_INTRANSFERIBLE;
    }

    /// @dev Soulbound: for tipos 0..6 only mints (from == 0) and burns by the owner (to == 0, via quemar) pass.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0) && !esTransferible(tokenId)) revert Intransferible(tokenId);
        return super._update(to, tokenId, auth);
    }

    // ---------------------------------------------------------------- metadata

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint8 tipo = tipoDe[tokenId];
        string memory nombre = nombreDe[tokenId];
        string memory json = string.concat(
            '{"name":"',
            Strings.escapeJSON(_titulo(tokenId, tipo, nombre)),
            '","description":"',
            _descripcion(tipo),
            '","attributes":',
            _atributos(tokenId, tipo, nombre),
            ',"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(tokenId, tipo, nombre))),
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _etiqueta(uint8 tipo) internal pure returns (string memory) {
        if (tipo == 0) return "Insignia Curso 1 - Fundamentos";
        if (tipo == 1) return "Insignia Curso 2 - DeFi";
        if (tipo == 2) return "Insignia Curso 3 - Infraestructura";
        if (tipo == 3) return "Insignia Curso 4 - DApps";
        if (tipo == 4) return "NFT propio";
        if (tipo == 5) return unicode"Bonus - Hackeá un contrato";
        if (tipo == 6) return "Certificado del recorrido";
        return "Recibo de pago";
    }

    function _titulo(uint256 tokenId, uint8 tipo, string memory nombre) internal pure returns (string memory) {
        if (tipo == TIPO_NFT) return nombre;
        if (tipo == TIPO_RECIBO) return string.concat("Recibo #", tokenId.toString(), " - ", nombre);
        return _etiqueta(tipo);
    }

    function _descripcion(uint8 tipo) internal pure returns (string memory) {
        if (tipo <= 3) {
            return unicode"Insignia del juego de la Diplomatura en Blockchain (LICDIA, UNLu). Intransferible.";
        }
        if (tipo == TIPO_NFT) return unicode"NFT diseñado por su dueño en el nivel bonus del juego LICDIA.";
        if (tipo == 5) {
            return unicode"Drenó una bóveda con reentrancy y la arregló con Checks-Effects-Interactions.";
        }
        if (tipo == 6) {
            return unicode"Certificado simbólico: completó los cuatro niveles del juego LICDIA. No es un título.";
        }
        return unicode"Recibo NFT emitido por la pasarela de pagos demo (USDL, sin valor real).";
    }

    function _atributos(uint256 tokenId, uint8 tipo, string memory nombre) internal view returns (string memory) {
        string memory s = string.concat(
            '[{"trait_type":"Tipo","value":"',
            _etiqueta(tipo),
            '"},{"trait_type":"Transferible","value":"',
            esTransferible(tokenId) ? "Si" : "No",
            '"}'
        );
        if (tipo <= 3) {
            s = string.concat(
                s, ',{"trait_type":"Curso","display_type":"number","value":', uint256(tipo + 1).toString(), "}"
            );
        } else if (tipo == TIPO_RECIBO) {
            s = string.concat(s, ',{"trait_type":"Producto","value":"', Strings.escapeJSON(nombre), '"}');
        } else if (bytes(nombre).length > 0 && tipo != TIPO_NFT) {
            s = string.concat(s, ',{"trait_type":"Nombre","value":"', Strings.escapeJSON(nombre), '"}');
        }
        return string.concat(s, "]");
    }

    function _glifo(uint8 tipo) internal pure returns (string memory) {
        if (tipo <= 3) return uint256(tipo + 1).toString();
        if (tipo == 5) return "&lt;/&gt;";
        if (tipo == 6) return unicode"★";
        return "$";
    }

    function _svg(uint256 tokenId, uint8 tipo, string memory nombre) internal pure returns (string memory) {
        string memory centro = tipo == TIPO_NFT ? _disenoPropio(tokenId, nombre) : _emblema(tipo);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" font-family="Helvetica,Arial,sans-serif">',
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#261951"/>',
            '<stop offset="1" stop-color="#4C1C7F"/></linearGradient></defs>',
            '<rect width="400" height="400" rx="28" fill="url(#g)"/>',
            '<rect x="14" y="14" width="372" height="372" rx="20" fill="none" stroke="#ffd782" stroke-opacity=".55"/>',
            unicode'<text x="200" y="56" text-anchor="middle" font-size="14" letter-spacing="4" fill="#c4b5fd">LICDIA · UNLu</text>',
            centro,
            _textos(tokenId, tipo, nombre)
        );
    }

    function _textos(uint256 tokenId, uint8 tipo, string memory nombre) internal pure returns (string memory) {
        string memory titulo = tipo == TIPO_NFT ? nombre : _etiqueta(tipo);
        string memory sub = tipo == TIPO_NFT ? "NFT propio" : nombre;
        return string.concat(
            '<text x="200" y="312" text-anchor="middle" font-size="19" font-weight="700" fill="#ffffff">',
            _escaparXML(titulo),
            '</text><text x="200" y="340" text-anchor="middle" font-size="15" fill="#c4b5fd">',
            _escaparXML(sub),
            '</text><text x="200" y="372" text-anchor="middle" font-size="11" fill="#c4b5fd" opacity=".75">#',
            tokenId.toString(),
            tipo > ULTIMO_INTRANSFERIBLE ? unicode" · transferible" : unicode" · intransferible",
            "</text></svg>"
        );
    }

    function _emblema(uint8 tipo) internal pure returns (string memory) {
        return string.concat(
            '<polygon points="200,92 279,138 279,230 200,276 121,230 121,138" fill="#261951" fill-opacity=".6" ',
            'stroke="#ffd782" stroke-width="5"/>',
            '<text x="200" y="',
            tipo == 5 ? "200" : "208",
            '" text-anchor="middle" font-size="',
            tipo == 5 ? "44" : "64",
            '" font-weight="700" fill="#ffd782">',
            _glifo(tipo),
            "</text>"
        );
    }

    /// @dev Bonus NFT: three circles whose hues and positions derive from the owner's chosen name.
    function _disenoPropio(uint256 tokenId, string memory nombre) internal pure returns (string memory s) {
        bytes32 h = keccak256(abi.encodePacked(nombre, tokenId));
        for (uint256 i = 0; i < 3; i++) {
            uint256 hue = (uint256(uint8(h[i * 3])) * 360) / 256;
            uint256 cx = 140 + (uint256(uint8(h[i * 3 + 1])) % 120);
            uint256 cy = 130 + (uint256(uint8(h[i * 3 + 2])) % 100);
            uint256 r = 36 + (uint256(uint8(h[i + 9])) % 34);
            s = string.concat(
                s,
                '<circle cx="',
                cx.toString(),
                '" cy="',
                cy.toString(),
                '" r="',
                r.toString(),
                '" fill="hsl(',
                hue.toString(),
                ',80%,65%)" fill-opacity=".7" stroke="#ffd782" stroke-width="2"/>'
            );
        }
    }

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
