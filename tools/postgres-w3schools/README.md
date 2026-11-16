# PostgreSQL de práctica (base de w3schools)

Base remota para que los estudiantes aprendan a conectarse desde pgAdmin, R y Python (Colab) y a hacer consultas. Es
la base del editor "Try it Yourself" de w3schools (`w3schools_postgresql.sql`: Northwind reducida, 8 tablas, 932
filas), en la VM de LICDIA, con un único usuario de solo lectura (`alumno`) que comparten todos. En el mismo servidor
está la base `eph` del curso (microdatos de la EPH de INDEC), también de solo lectura para `alumno`.

Desde afuera de la UNLu solo pasan los puertos 80 y 443, y los dos los usa nginx. `pg-puerto80` desvía a PostgreSQL
las conexiones que llegan al 80, hasta una fecha (la del fin del curso) o por unas horas. El 443 no se toca: el sitio
y los asistentes siguen funcionando.

## Instalación (una vez, con sudo)

Desde la Mac, con la VPN conectada:

```
rsync -rlt --exclude .DS_Store tools/postgres-w3schools/ licdia:postgres-w3schools/
ssh -t licdia 'sudo bash ~/postgres-w3schools/instalar.sh'
```

La clave de `alumno` queda en `~/postgres-w3schools-credenciales.csv` de la VM:
`ssh licdia 'cat ~/postgres-w3schools-credenciales.csv'`.

## Abrir y cerrar el puerto

```
ssh licdia 'sudo pg-puerto80 abrir hasta 2026-11-30'   # hasta las 23:59 de ese día, aunque la VM se reinicie
ssh licdia 'sudo pg-puerto80 abrir 3'                  # solo por 3 horas (4 si no se indica)
ssh licdia 'sudo pg-puerto80 cerrar'                   # antes de tiempo
ssh licdia 'sudo pg-puerto80 estado'
```

Para extender el plazo se vuelve a correr `abrir hasta` con la nueva fecha. Mientras está abierto,
`http://licdia.unlu.edu.ar` no redirige a https (los navegadores ya entran por https). certbot sigue renovando el
certificado: sus hooks (`/etc/letsencrypt/renewal-hooks`) le devuelven el 80 a nginx durante la renovación y después
lo vuelven a desviar. Al arrancar la VM, `pg-puerto80.service` restaura el desvío si la fecha no pasó.

## Base eph

Se carga desde la base `eph` armada con el cuaderno "De la EPH a PostgreSQL". Desde la Mac, con la VPN conectada:

```
pg_dump -Fc --no-owner --no-privileges -d eph -f eph.dump   # o un eph.dump ya generado
rsync -rlt --exclude .DS_Store tools/postgres-w3schools/ licdia:postgres-w3schools/
scp eph.dump licdia:
ssh licdia 'bash ~/postgres-w3schools/eph.sh ~/eph.dump && rm ~/eph.dump'
```

`eph.sh` no toca la base si ya existe. Para reemplazarla, primero `ssh licdia 'dropdb eph'`.

## Datos para los estudiantes

En pgAdmin: "Register" → "Server".

- General → Name: `w3schools` (cualquier nombre).
- Connection → Host name/address: `170.210.103.79`; Port: `80`; Maintenance database: `w3schools`;
  Username: `alumno`; Password: la de la planilla.

Las tablas quedan en `w3schools` → Schemas → public → Tables. Las consultas de w3schools corren tal cual
(`SELECT * FROM Customers;`). Para la EPH, la base es `eph`.

Desde R o Python (por ejemplo, en Colab) los datos son los mismos: host `170.210.103.79`, puerto `80`, base
`w3schools` o `eph`, usuario `alumno`. La conexión usa SSL, como pide el servidor.

`alumno` solo puede consultar: no modifica datos ni crea tablas. Cada consulta se corta a los 30 segundos para que un
producto cartesiano no ocupe la VM, y PostgreSQL tiene un tope de 1 GB de memoria (`memoria.conf`).
