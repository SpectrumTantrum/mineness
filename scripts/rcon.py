#!/usr/bin/env python3
"""Local server administration. Reads credentials from mc-server/server.properties."""
import socket
import struct
import sys
from pathlib import Path


def packet(req_id, kind, payload):
    body = struct.pack('<ii', req_id, kind) + payload.encode() + b'\0\0'
    return struct.pack('<i', len(body)) + body


def read_exact(sock, size):
    data = b''
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise RuntimeError('RCON connection closed mid-response')
        data += chunk
    return data


def read_packet(sock):
    size, = struct.unpack('<i', read_exact(sock, 4))
    if not 10 <= size <= 4_194_304:
        raise RuntimeError('Invalid RCON packet size')
    data = read_exact(sock, size)
    req_id, kind = struct.unpack('<ii', data[:8])
    return req_id, kind, data[8:-2].decode(errors='replace')


def rcon(command):
    path = Path(__file__).resolve().parents[1] / 'mc-server/server.properties'
    properties = dict(line.split('=', 1) for line in path.read_text().splitlines()
                      if '=' in line and not line.startswith('#'))
    with socket.create_connection(('127.0.0.1', int(properties.get('rcon.port', 25575))), timeout=8) as sock:
        sock.sendall(packet(1, 3, properties['rcon.password']))
        if read_packet(sock)[0] == -1:
            raise RuntimeError('RCON authentication failed')
        sock.sendall(packet(2, 2, command))
        return read_packet(sock)[2]


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('Usage: python3 scripts/rcon.py <server command>')
    print(rcon(' '.join(sys.argv[1:])))
