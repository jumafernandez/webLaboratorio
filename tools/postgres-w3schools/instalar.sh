#!/bin/bash
# Instala PostgreSQL en la VM de LICDIA con la base de práctica de w3schools. Se corre con sudo desde la copia del
# proyecto:
#   sudo bash ~/postgres-w3schools/instalar.sh
# Es idempotente: en una segunda corrida no toca la base ni la clave que ya existen. Deja:
# - PostgreSQL 17 de Debian en el 5432, con SSL y tope de memoria. Desde afuera de la UNLu ese puerto está filtrado:
#   los estudiantes entran por el 80 mientras pg-puerto80 lo desvía (ver README.md);
# - el rol "administrador" de PostgreSQL (superusuario, por peer), para que base.sh corra sin sudo;
# - /usr/local/sbin/pg-puerto80 y la regla de sudoers para que administrador lo abra y lo cierre sin contraseña;
# - pg-puerto80.service, que al arrancar la VM restaura el desvío si quedó abierto hasta una fecha, y los hooks de
#   certbot que le devuelven el 80 a nginx mientras renueva el certificado;
# - la base w3schools y alumno, el usuario de solo lectura que comparten los estudiantes (base.sh).
set -euo pipefail

ORIGEN="$(cd "$(dirname "$0")" && pwd)"
VERSION=17
CONF=/etc/postgresql/$VERSION/main
UNIDAD=postgresql@$VERSION-main
USUARIO=${SUDO_USER:-administrador}
cd /   # postgres no puede entrar a la carpeta personal desde la que se lanza

echo "== 1. PostgreSQL (apt sale por el proxy de la UNLu, configurado en /etc/apt/apt.conf)"
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -y -q postgresql-$VERSION

echo "== 2. Configuración"
grep -q "^include_dir = 'conf.d'" "$CONF/postgresql.conf" || { echo "falta include_dir = 'conf.d' en $CONF/postgresql.conf" >&2; exit 1; }
install -m 644 -o postgres -g postgres "$ORIGEN/postgresql-clase.conf" "$CONF/conf.d/clase.conf"
if ! grep -q '+alumnos' "$CONF/pg_hba.conf"; then
    cp "$CONF/pg_hba.conf" /root/pg_hba.antes-de-alumnos
    cat >> "$CONF/pg_hba.conf" <<'EOF'

# Usuarios de consulta (grupo alumnos; hoy, solo alumno): desde cualquier dirección y solo con SSL. Los superusuarios
# entran solo desde la VM, por peer.
hostssl all             +alumnos        0.0.0.0/0               scram-sha-256
EOF
    echo "   reglas agregadas a pg_hba.conf (copia previa en /root/pg_hba.antes-de-alumnos)"
fi

echo "== 3. Tope de memoria"
mkdir -p "/etc/systemd/system/$UNIDAD.service.d"
install -m 644 "$ORIGEN/memoria.conf" "/etc/systemd/system/$UNIDAD.service.d/memoria.conf"
systemctl daemon-reload
systemctl restart "$UNIDAD"
for _ in $(seq 1 30); do pg_isready -q && break; sleep 1; done
runuser -u postgres -- psql -X -qtAc "SELECT '   ssl: ' || current_setting('ssl') || ', escucha en: ' || current_setting('listen_addresses')"

echo "== 4. Rol de administrador en PostgreSQL"
if ! runuser -u postgres -- psql -X -qtAc "SELECT 1 FROM pg_roles WHERE rolname = '$USUARIO'" | grep -q 1; then
    runuser -u postgres -- createuser --superuser "$USUARIO"
    echo "   creado $USUARIO (superusuario; entra solo desde la VM, por peer)"
fi

echo "== 5. Puerto 80 a pedido o hasta una fecha"
install -m 755 -o root -g root "$ORIGEN/pg-puerto80" /usr/local/sbin/pg-puerto80
install -m 644 -o root -g root "$ORIGEN/pg-puerto80.service" /etc/systemd/system/pg-puerto80.service
systemctl daemon-reload
systemctl enable --quiet pg-puerto80.service
if [ -d /etc/letsencrypt ]; then
    # certbot valida el dominio por el 80: mientras renueva, el 80 vuelve a nginx y después se restaura
    install -d /etc/letsencrypt/renewal-hooks/pre /etc/letsencrypt/renewal-hooks/post
    printf '#!/bin/sh\nexec /usr/local/sbin/pg-puerto80 pausar\n' > /etc/letsencrypt/renewal-hooks/pre/pg-puerto80
    printf '#!/bin/sh\nexec /usr/local/sbin/pg-puerto80 restaurar\n' > /etc/letsencrypt/renewal-hooks/post/pg-puerto80
    chmod 755 /etc/letsencrypt/renewal-hooks/pre/pg-puerto80 /etc/letsencrypt/renewal-hooks/post/pg-puerto80
    echo "   hooks de certbot instalados"
fi
REGLA=/etc/sudoers.d/pg-puerto80
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/pg-puerto80\n' "$USUARIO" > "$REGLA.nuevo"
chmod 440 "$REGLA.nuevo"
if visudo -cf "$REGLA.nuevo" >/dev/null; then mv "$REGLA.nuevo" "$REGLA"; else rm -f "$REGLA.nuevo"; echo "regla de sudoers inválida, no se instaló" >&2; exit 1; fi
/usr/local/sbin/pg-puerto80 estado

echo "== 6. Base w3schools y usuario de consulta"
runuser -u "$USUARIO" -- bash "$ORIGEN/base.sh"

echo "== 7. Prueba"
systemctl --no-pager --lines=0 status "$UNIDAD" | head -3 || true
runuser -u "$USUARIO" -- psql -X -d w3schools -qtAc "SELECT '   tablas en w3schools: ' || count(*) FROM pg_tables WHERE schemaname = 'public'"
