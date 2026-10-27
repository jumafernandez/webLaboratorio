#!/bin/bash
# Copia el widget a una copia de trabajo del repo del sitio, para publicarlo con el flujo normal del sitio.
#   bash despliegue/exportar_widget.sh <carpeta-del-sitio>             # simulación: muestra qué haría, no copia nada
#   bash despliegue/exportar_widget.sh <carpeta-del-sitio> --aplicar   # copia de verdad
# Deja widget/*.js y widget/niveles/ en <sitio>/js/blockchain-juego/ y widget/widget.css en
# <sitio>/css/blockchain-juego.css, y muestra las dos etiquetas que hay que agregar a mano en blockchain-dev/index.html.
# No toca el HTML, no hace commit ni push: eso queda para la revisión del sitio.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
SITIO="${1:-}"
APLICAR=0
[ "${2:-}" = "--aplicar" ] && APLICAR=1
if [ -z "$SITIO" ] || [ "$#" -gt 2 ] || { [ "$#" -eq 2 ] && [ "$APLICAR" = 0 ]; }; then
    echo "uso: $0 <carpeta-del-sitio> [--aplicar]" >&2
    exit 1
fi
SITIO="$(cd "$SITIO" && pwd)"
PORTADA="$SITIO/blockchain-dev/index.html"
if [ ! -f "$PORTADA" ] || [ ! -d "$SITIO/js" ] || [ ! -d "$SITIO/css" ]; then
    echo "$SITIO no parece el repo del sitio (faltan blockchain-dev/index.html, js/ o css/)." >&2
    exit 1
fi

OPC=(-rt --itemize-changes)
if [ "$APLICAR" = 1 ]; then
    echo "== Copiando el widget a $SITIO"
else
    OPC+=(--dry-run)
    echo "== SIMULACIÓN (no se copia nada; agregar --aplicar para hacerlo) sobre $SITIO"
fi

mkdir_si() { if [ "$APLICAR" = 1 ]; then mkdir -p "$1"; fi; }
mkdir_si "$SITIO/js/blockchain-juego"
# Solo módulos .js: la carpeta de destino es del widget y --delete la deja igual a widget/ (sin el css).
rsync "${OPC[@]}" --delete --include '*/' --include '*.js' --exclude '*' "$RAIZ/widget/" "$SITIO/js/blockchain-juego/"
rsync "${OPC[@]}" "$RAIZ/widget/widget.css" "$SITIO/css/blockchain-juego.css"

ETIQUETAS='    <link href="../css/blockchain-juego.css" rel="stylesheet" />
    <script type="module" src="../js/blockchain-juego/main.js"></script>'
echo
if grep -q 'js/blockchain-juego/main.js' "$PORTADA"; then
    echo "== blockchain-dev/index.html ya carga el widget."
else
    echo "== Agregar a mano en blockchain-dev/index.html, justo antes de </body>:"
    echo "$ETIQUETAS"
fi
echo
echo "El widget llama a /blockchain-dev/api/: sin el backend (despliegue/instalar.sh) funciona igual, sin IA."
