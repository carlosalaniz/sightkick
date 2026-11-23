#!/bin/sh
# Runs at container start (nginx image's /docker-entrypoint.d). When
# SK_STEM_UPSTREAM is set, e.g. http://stem-server:8765, proxies /stem-api/ to
# it so the app reaches the stem server on its own origin, with no CORS and
# without exposing the stem server's port.
set -eu

conf_dir=/etc/nginx/sightkick
conf="$conf_dir/stem-proxy.conf"
mkdir -p "$conf_dir"

if [ -z "${SK_STEM_UPSTREAM:-}" ]; then
    rm -f "$conf"
    echo "sightkick: SK_STEM_UPSTREAM not set, /stem-api/ disabled"
    exit 0
fi

upstream="${SK_STEM_UPSTREAM%/}"

# Look the upstream up per request (cached 10 s) through the container's DNS
# server, so a recreated stem server with a new address is found again, and
# nginx starts even while the stem server isn't up yet.
resolver=""
ns="$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)"
if [ -n "$ns" ]; then
    case "$ns" in *:*) ns="[$ns]" ;; esac
    resolver="resolver $ns valid=10s;"
fi

cat > "$conf" <<CONF
location /stem-api/ {
    $resolver
    set \$sk_stem_upstream $upstream;
    rewrite ^/stem-api/(.*)\$ /\$1 break;
    proxy_pass \$sk_stem_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    # Uploads are whole songs; stream them through rather than buffering.
    client_max_body_size ${SK_MAX_UPLOAD_MB:-200}m;
    proxy_request_buffering off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
CONF
echo "sightkick: proxying /stem-api/ to $upstream${ns:+ (resolver $ns)}"
