#!/bin/sh
set -eu

# The release attaches only frontend to ingress and sets dns: [127.0.0.1].
# Docker DNS can resolve backend, but cannot forward external names upstream.
# Resolve before installing the firewall; no application has started yet.
backend_ips="$(timeout 10 getent hosts backend | awk '$1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print $1 }' | sort -u)"
if [ -z "$backend_ips" ] || [ "$(printf '%s\n' "$backend_ips" | wc -l)" -ne 1 ]; then
    echo 'offline ingress: exactly one backend IPv4 address is required' >&2
    exit 1
fi

# Fail closed on a missing capability, unsupported IPv6 firewall or rule error.
# These rules affect only this container namespace; they never modify the host.
iptables -w 5 -P OUTPUT DROP
ip6tables -w 5 -P OUTPUT DROP
iptables -w 5 -F OUTPUT
ip6tables -w 5 -F OUTPUT
iptables -w 5 -A OUTPUT -o lo -j ACCEPT
ip6tables -w 5 -A OUTPUT -o lo -j ACCEPT
iptables -w 5 -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -w 5 -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -w 5 -A OUTPUT -p tcp -d "$backend_ips/32" --dport 3000 -j ACCEPT

# NET_RAW could bypass IP OUTPUT via packet sockets. Neither capability may be
# regained by Nginx or any child, including through a privileged executable.
exec setpriv --bounding-set=-net_admin,-net_raw --inh-caps=-all \
    --ambient-caps=-all --no-new-privs /docker-entrypoint.sh "$@"
