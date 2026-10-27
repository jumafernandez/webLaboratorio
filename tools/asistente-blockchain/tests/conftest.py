"""Base de pruebas limpia en cada corrida: los topes diarios del registro (preguntas por persona) se acumulan en
tests/.datos-prueba y, después de unas cuantas corridas en el mismo día, las pruebas del agente chocaban con el tope."""

import os
import pathlib
import shutil

shutil.rmtree(pathlib.Path(__file__).parent / ".datos-prueba", ignore_errors=True)

# The .env may point the backend at Base Sepolia (real mode, keystore, low CADENA_MIN_ETH). An empty value in the
# environment wins over .env, so the tests start from the defaults (simulated chain) and set what each one needs.
for _nombre in ("CADENA_MODO", "CADENA_RPC", "CADENA_CHAIN_ID", "CADENA_DEPLOY", "CADENA_KEYSTORE",
                "CADENA_KEYSTORE_CLAVE_ARCHIVO", "CADENA_CLAVE_DEV", "CADENA_EXPLORADOR", "CADENA_MIN_ETH"):
    os.environ.setdefault(_nombre, "")
