# Formularios propios

`maestria-registro.gs` recibe los formularios de la Maestría en Ciencia de Datos (charla informativa y preinscripción),
guarda cada envío en una planilla y avisa por correo a licdia.unlu@gmail.com. Es una aplicación web de Apps Script en
esa misma cuenta: los datos no pasan por servidores de terceros ni por la VM, que no tiene salida para correo.

Está instalado en licdia.unlu@gmail.com como el proyecto de Apps Script "Registro maestría" (implementación
"Formularios de la maestría"); su URL es la de `REGISTRO_URL`.

## Instalación (una vez, con la sesión de licdia.unlu@gmail.com)

1. Entrar a https://script.google.com/home, "Nuevo proyecto", y pegar el contenido de `maestria-registro.gs` en
   lugar del código de ejemplo. Guardar con el nombre "Registro maestría".
2. Elegir la función `probar` y "Ejecutar". Google pide autorizar el acceso a Hojas de cálculo y Gmail de la cuenta:
   aceptar (el aviso de "app no verificada" es normal en scripts propios: "Configuración avanzada" → "Ir a …").
   Tiene que llegar un correo de prueba y aparecer la planilla "Registros · Maestría en Ciencia de Datos" en el Drive.
3. "Implementar" → "Nueva implementación" → tipo "Aplicación web". Ejecutar como: "Yo"; quién tiene acceso:
   "Cualquier persona". Implementar y copiar la URL que termina en `/exec`.
4. Esa URL va en `REGISTRO_URL` de `maestria-ciencia-datos/index.html` y de
   `maestria-ciencia-datos/inscripcion-maestria-ciencia-datos/index.html`. Sin URL, los formularios siguen enviando al
   webhook anterior.

Si se cambia el script, hay que publicar una versión nueva en "Implementar" → "Administrar implementaciones" (la URL
se mantiene).
