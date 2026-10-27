# Galería de proyectos: cómo agregar uno

La página `/blockchain-dev/proyectos/` se arma sola a partir de `proyectos.json`. No hay build: se edita el JSON, se hace commit y se despliega el sitio.

## Regla de consentimiento (obligatoria)

**No se publica el nombre de ningún alumno sin su consentimiento explícito** (por escrito, por ejemplo un mail o un mensaje del aula). Sin consentimiento:

- `"consent": false` y se usa `"pseudonym"` (por ejemplo `"Equipo 3"` o un alias que el alumno elija), o se deja vacío y la página muestra "Equipo anónimo".
- El campo `name` puede quedar vacío. Si `consent` es `false`, la página nunca muestra `name`, pero igual no lo cargues en el JSON si no hace falta: el archivo es público.
- Los repos y demos solo se enlazan si los dueños aceptaron que se publiquen.

## Esquema

```json
{
  "schema": 1,
  "network": { "chainId": 84532, "name": "Base Sepolia", "explorer": "https://base-sepolia.blockscout.com", "rpc": "https://sepolia.base.org" },
  "projects": [
    {
      "id": "pasarela-equipo-1",
      "title": "Pasarela de pago Web3",
      "course": "curso-4",
      "cohort": "2026",
      "description": "Dos o tres frases, en español rioplatense, sin exageraciones: qué hace y qué contratos tiene.",
      "students": [
        { "name": "Nombre Apellido", "pseudonym": "", "consent": true },
        { "name": "", "pseudonym": "Equipo 1", "consent": false }
      ],
      "contracts": [
        { "name": "PaymentGateway", "address": "0x...", "chainId": 84532, "verified": true }
      ],
      "repo": "https://github.com/usuario/repo",
      "demo": "https://ejemplo.org",
      "tags": ["pagos", "ERC-20", "ERC-721"]
    }
  ]
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `id` | sí | Único, minúsculas y guiones. |
| `title` | sí | Texto plano. |
| `course` | sí | `curso-1` a `curso-4` (filtro de la página). |
| `cohort` | sí | Año de la cohorte, como texto (`"2026"`). |
| `description` | sí | Texto plano, hasta unas 300 letras. |
| `students[]` | sí | `name`, `pseudonym`, `consent` (booleano). Ver regla de consentimiento. |
| `contracts[]` | no | `address` de 42 caracteres, `chainId` (84532 = Base Sepolia), `verified` solo `true` si el contrato figura verificado en Sourcify/Blockscout. |
| `repo`, `demo` | no | Solo URLs `https://`. |
| `tags` | no | Lista corta; alimenta el filtro. |

Todo el texto se muestra como texto plano (nada se interpreta como HTML).

## Pasos

1. Pedir el consentimiento y los datos al equipo.
2. Verificar el contrato en <https://base-sepolia.blockscout.com> (pestaña "Contract": debe figurar el código fuente).
3. Agregar el objeto a `projects` y validar el JSON (`python3 -m json.tool proyectos.json`).
4. Abrir la página en local (`python3 -m http.server`) y revisar la tarjeta y la verificación en vivo.
5. Commit y deploy.

No se publican las implementaciones de referencia de la cátedra ni se enlazan.
